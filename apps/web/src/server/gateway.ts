import "server-only";
import {
  MODELS,
  RailError,
  VeniceChat,
  VeniceInsufficientBalance,
  costUsd,
  parseVenicePrices,
  type ChatMessage,
  type LivePrices,
  type ModelDef,
  type VeniceClient,
} from "@pay/rail/browser";
import { apiWalletAccount, sweepToCredit, veniceForApiWallet } from "./api-wallet.ts";
import { KeyError, authorize, recordSpend, type KeyRecord } from "./keys.ts";

/**
 * Hosted OpenAI-compatible endpoint for API keys. Stateless per request:
 * check key + limits -> sign with the user's API wallet (SIWX) -> forward to
 * Venice -> meter real usage -> charge the key. Prompts are never stored or logged.
 */
const MAX_BODY = 4 * 1024 * 1024;

export function oaiError(status: number, message: string, code: string): Response {
  return Response.json({ error: { message, type: code, code } }, { status, headers: { "cache-control": "no-store" } });
}

function bearer(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export function resolveModel(model: unknown): ModelDef | undefined {
  if (typeof model !== "string") return undefined;
  return MODELS[model] ?? Object.values(MODELS).find((m) => m.id === model);
}

let prices: { at: number; map: LivePrices } | undefined;
async function livePrices(venice: VeniceClient): Promise<LivePrices> {
  if (prices && Date.now() - prices.at < 10 * 60_000) return prices.map;
  try {
    prices = { at: Date.now(), map: parseVenicePrices((await venice.models("text")) as never) };
  } catch {
    prices = { at: Date.now(), map: new Map() };
  }
  return prices.map;
}

export async function handleModels(req: Request): Promise<Response> {
  try {
    const rec = await authorize(bearer(req), null);
    const allowed = Object.values(MODELS).filter((m) => !rec.models.length || rec.models.includes(m.key));
    return Response.json({
      object: "list",
      data: allowed.map((m) => ({ id: m.key, object: "model", created: 0, owned_by: "venice", name: m.label, venice_id: m.id, privacy: m.tier })),
    });
  } catch (e) {
    return toResponse(e);
  }
}

export async function handleChat(req: Request): Promise<Response> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return oaiError(413, "Request body too large.", "too_large");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return oaiError(400, "Request body is not valid JSON.", "bad_json");
    }
    const def = resolveModel(body.model);
    if (!def) return oaiError(400, `Unknown model "${String(body.model)}". GET /v1/models lists the allowed ones.`, "unknown_model");

    const rec = await authorize(bearer(req), def.key);
    const venice = veniceForApiWallet(await apiWalletAccount(rec.uid));
    const live = await livePrices(venice);

    return def.e2ee ? await e2ee(rec, venice, def, body, live) : await passthrough(rec, venice, def, body, live);
  } catch (e) {
    return toResponse(e);
  }
}

/**
 * Up-front reservation for streamed requests: a client that aborts before the
 * final usage chunk must still be charged. Estimate = prompt size + max output
 * tokens (default 2048) at live prices; corrected to the real cost at the end.
 */
function reserve(def: ModelDef, body: Record<string, unknown>, live: LivePrices): number {
  const inTok = Math.ceil(JSON.stringify(body.messages ?? []).length / 3);
  const outTok = Number(body.max_tokens ?? body.max_completion_tokens ?? 2048) || 2048;
  return costUsd(def, { prompt_tokens: inTok, completion_tokens: Math.min(outTok, 32_768) }, live) ?? 0;
}

/** Call Venice; if credit ran out but USDC sits on the API wallet, top it up and retry once. */
async function withTopUp<T>(rec: KeyRecord, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof VeniceInsufficientBalance && (await sweepToCredit(rec.uid)).toppedUpUsd > 0) return call();
    throw e;
  }
}

async function passthrough(rec: KeyRecord, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>, live: LivePrices): Promise<Response> {
  const vp = (body.venice_parameters as Record<string, unknown> | undefined) ?? {};
  const upstream: Record<string, unknown> = { ...body, model: def.id, venice_parameters: { ...vp, include_venice_system_prompt: false } };

  if (!body.stream) {
    const json = (await withTopUp(rec, () => venice.chat({ ...upstream, stream: false }))) as { usage?: Parameters<typeof costUsd>[1] };
    await recordSpend(rec, costUsd(def, json.usage, live) ?? 0);
    return Response.json({ ...json, model: def.key });
  }

  upstream.stream_options = { ...((body.stream_options as object) ?? {}), include_usage: true };
  const held = reserve(def, body, live);
  await recordSpend(rec, held);
  let res: Response;
  try {
    res = await withTopUp(rec, () => venice.chatStream(upstream));
  } catch (e) {
    await recordSpend(rec, -held); // nothing was generated
    throw e;
  }
  // Pass the SSE stream through untouched, watching for the final usage chunk to charge the key.
  let buf = "";
  let usage: Parameters<typeof costUsd>[1];
  const decoder = new TextDecoder();
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      ctl.enqueue(chunk);
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("data:") && line.includes('"usage"')) {
          try {
            usage = (JSON.parse(line.slice(5)) as { usage?: typeof usage }).usage ?? usage;
          } catch {}
        }
      }
    },
    async flush() {
      // Replace the reservation with the real cost (if usage never arrived, keep the reservation).
      const actual = costUsd(def, usage, live);
      if (actual !== undefined) await recordSpend(rec, actual - held);
    },
  });
  return new Response(res.body!.pipeThrough(tap), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

/** TEE models: attested E2EE between our server and the enclave (server-side client; tools dropped). */
async function e2ee(rec: KeyRecord, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>, live: LivePrices): Promise<Response> {
  const chat = new VeniceChat({ venice });
  const messages = fold((body.messages as Array<{ role: string; content: unknown }>) ?? []);
  const { deltas } = await withTopUp(rec, () =>
    chat.stream({
      mode: "private",
      model: def.key,
      messages,
      maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
    }),
  );
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  if (!body.stream) {
    let text = "";
    let cost = 0;
    let usage: unknown;
    for await (const d of deltas) {
      if (d.type === "text") text += d.text;
      else if (d.type === "usage") (usage = d.usage), (cost = d.costUsd ?? 0);
    }
    await recordSpend(rec, cost);
    return Response.json({ id, object: "chat.completion", created, model: def.key, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
  }

  const enc = new TextEncoder();
  const held = reserve(def, body, live);
  await recordSpend(rec, held);
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (delta: Record<string, unknown>, finish: string | null = null) =>
        ctl.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: def.key, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
      let cost: number | undefined;
      send({ role: "assistant" });
      try {
        for await (const d of deltas) {
          if (d.type === "text") send({ content: d.text });
          else if (d.type === "reasoning") send({ reasoning_content: d.text });
          else if (d.type === "usage") cost = d.costUsd;
        }
        send({}, "stop");
        ctl.enqueue(enc.encode("data: [DONE]\n\n"));
        finished = true;
      } finally {
        // Real cost replaces the reservation; an aborted stream keeps the reservation.
        if (finished && cost !== undefined) await recordSpend(rec, cost - held);
        ctl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" } });
}

/** E2EE only encrypts user/system roles; fold everything else into one system message. */
function fold(msgs: Array<{ role: string; content: unknown }>): ChatMessage[] {
  const text = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";
  const last = [...msgs].reverse().find((m) => m.role === "user");
  const prior = last ? msgs.slice(0, msgs.lastIndexOf(last)) : msgs;
  const transcript = prior.map((m) => `${m.role}: ${text(m.content)}`).filter((l) => !/:\s*$/.test(l)).join("\n\n");
  return [...(transcript ? [{ role: "system" as const, content: `Conversation so far:\n\n${transcript}` }] : []), { role: "user", content: last ? text(last.content) : "" }];
}

function toResponse(e: unknown): Response {
  if (e instanceof KeyError) return oaiError(e.status, e.message, e.code);
  if (e instanceof VeniceInsufficientBalance) {
    return oaiError(402, "Out of credit. Add credit to your API wallet on the website (account menu → API keys).", "insufficient_credit");
  }
  if (e instanceof RailError) return oaiError(400, e.message, e.code.toLowerCase());
  const status = (e as { status?: number }).status;
  return oaiError(status && status >= 400 && status < 600 ? status : 502, (e as Error)?.message?.slice(0, 300) ?? "Upstream error", "upstream_error");
}
