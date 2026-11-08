import "server-only";
import {
  MODELS,
  RailError,
  findModel,
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

export const resolveModel = (model: unknown): ModelDef | undefined => findModel(model, true);

const MAX_OUTPUT_TOKENS = 32_768;
/** Venice parameters a key holder may set. Everything else (web search, scraping, ...) is billed per request, not per token, so we can't meter it. */
const ALLOWED_VENICE_PARAMS = ["disable_thinking", "strip_thinking_response"] as const;

/** Read the body with a hard cap, without buffering more than MAX_BODY. */
async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) all.set(c, o), (o += c.byteLength);
  return new TextDecoder().decode(all);
}

/** Validates and normalizes the fields we meter or override. Returns an error message, or null. */
export function checkBody(body: Record<string, unknown>): string | null {
  for (const k of ["max_tokens", "max_completion_tokens"] as const) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    if (!(typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_OUTPUT_TOKENS)) return `${k} must be an integer from 1 to ${MAX_OUTPUT_TOKENS}.`;
  }
  if (body.n !== undefined && body.n !== 1) return "Only n = 1 is supported.";
  if (body.messages !== undefined && !Array.isArray(body.messages)) return "messages must be an array.";
  return null;
}

export function veniceParams(body: Record<string, unknown>): Record<string, unknown> {
  const vp = body.venice_parameters && typeof body.venice_parameters === "object" ? (body.venice_parameters as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { include_venice_system_prompt: false };
  for (const k of ALLOWED_VENICE_PARAMS) if (typeof vp[k] === "boolean") out[k] = vp[k];
  return out;
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
    const text = await readBody(req);
    if (text === null) return oaiError(413, "Request body too large.", "too_large");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return oaiError(400, "Request body is not valid JSON.", "bad_json");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return oaiError(400, "Request body must be a JSON object.", "bad_json");
    const def = resolveModel(body.model);
    if (!def) return oaiError(400, `Unknown model "${String(body.model).slice(0, 80)}". GET /v1/models lists the allowed ones.`, "unknown_model");
    const bad = checkBody(body);
    if (bad) return oaiError(400, bad, "bad_request");

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
export function reserve(def: ModelDef, body: Record<string, unknown>, live: LivePrices): number {
  const inTok = Math.ceil(JSON.stringify(body.messages ?? []).length / 3);
  const asked = Number(body.max_tokens ?? body.max_completion_tokens ?? 2048);
  const outTok = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, MAX_OUTPUT_TOKENS) : 2048;
  return Math.max(0, costUsd(def, { prompt_tokens: inTok, completion_tokens: outTok }, live) ?? 0);
}

/**
 * Pass an OpenAI-style SSE stream through untouched and call `settle` once with
 * the first usage object seen. It settles while the stream is still flowing (the
 * usage chunk comes right before [DONE]), not at the end: clients such as opencode
 * hang up right after [DONE], which cancels the pipe, and an end-of-stream hook
 * would never run, leaving the whole reservation charged. No usage at all keeps
 * the reservation.
 */
export function meterStream(settle: (usage: unknown) => Promise<void>): TransformStream<Uint8Array, Uint8Array> {
  let buf = "";
  let settled = false;
  const decoder = new TextDecoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, ctl) {
      if (settled) return ctl.enqueue(chunk);
      buf += decoder.decode(chunk, { stream: true });
      let usage: unknown;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (usage === undefined && line.startsWith("data:") && line.includes('"usage"')) {
          try {
            const u = (JSON.parse(line.slice(5)) as { usage?: unknown }).usage;
            if (u && typeof u === "object") usage = u;
          } catch {}
        }
      }
      if (usage !== undefined) {
        settled = true;
        buf = "";
        await settle(usage).catch(() => {});
      }
      ctl.enqueue(chunk);
    },
  });
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
  const upstream: Record<string, unknown> = { ...body, model: def.id, venice_parameters: veniceParams(body) };
  // Every request reserves an estimate first, so a reply without usage (or an aborted stream) is still charged.
  const held = reserve(def, body, live);
  const day = await recordSpend(rec, held);

  if (!body.stream) {
    let json: { usage?: Parameters<typeof costUsd>[1] };
    try {
      json = (await withTopUp(rec, () => venice.chat({ ...upstream, stream: false }))) as typeof json;
    } catch (e) {
      await recordSpend(rec, -held, day); // nothing was generated
      throw e;
    }
    const actual = costUsd(def, json.usage, live);
    if (actual !== undefined) await recordSpend(rec, actual - held, day);
    return Response.json({ ...json, model: def.key });
  }

  upstream.stream_options = { include_usage: true };
  let res: Response;
  try {
    res = await withTopUp(rec, () => venice.chatStream(upstream));
  } catch (e) {
    await recordSpend(rec, -held, day); // nothing was generated
    throw e;
  }
  // Pass the SSE stream through untouched; charge the real cost as soon as the usage chunk goes by.
  const tap = meterStream(async (usage) => {
    const actual = costUsd(def, usage as Parameters<typeof costUsd>[1], live);
    if (actual !== undefined) await recordSpend(rec, actual - held, day);
  });
  return new Response(res.body!.pipeThrough(tap), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

/** TEE models: attested E2EE between our server and the enclave (server-side client; tools dropped). */
async function e2ee(rec: KeyRecord, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>, live: LivePrices): Promise<Response> {
  const chat = new VeniceChat({ venice });
  const messages = fold((body.messages as Array<{ role: string; content: unknown }>) ?? []);
  const held = reserve(def, body, live);
  const day = await recordSpend(rec, held);
  let deltas: Awaited<ReturnType<VeniceChat["stream"]>>["deltas"];
  try {
    ({ deltas } = await withTopUp(rec, () =>
      chat.stream({
        mode: "private",
        model: def.key,
        messages,
        maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      }),
    ));
  } catch (e) {
    await recordSpend(rec, -held, day); // nothing was generated
    throw e;
  }
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  if (!body.stream) {
    let text = "";
    let cost: number | undefined;
    let usage: unknown;
    for await (const d of deltas) {
      if (d.type === "text") text += d.text;
      else if (d.type === "usage") (usage = d.usage), (cost = d.costUsd);
    }
    // Real cost replaces the reservation (a decryption failure mid-way throws above and keeps it).
    if (cost !== undefined) await recordSpend(rec, cost - held, day);
    return Response.json({ id, object: "chat.completion", created, model: def.key, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (delta: Record<string, unknown>, finish: string | null = null) =>
        ctl.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: def.key, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
      let cost: number | undefined;
      try {
        send({ role: "assistant" });
        for await (const d of deltas) {
          if (d.type === "text") send({ content: d.text });
          else if (d.type === "reasoning") send({ reasoning_content: d.text });
          else if (d.type === "usage") cost = d.costUsd;
        }
        // Settle before the last bytes go out: a client may hang up right after [DONE].
        // An aborted or failed stream never gets here and keeps the reservation.
        if (cost !== undefined) await recordSpend(rec, cost - held, day).catch(() => {});
        send({}, "stop");
        ctl.enqueue(enc.encode("data: [DONE]\n\n"));
      } finally {
        try {
          ctl.close();
        } catch {}
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
