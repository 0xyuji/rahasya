import "server-only";
import {
  HttpError,
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
import { KeyError, assertModelAllowed, authorize, recordSpend, type KeyRecord } from "./keys.ts";
import { keepAliveForRequest } from "./runtime.ts";

/**
 * Hosted OpenAI-compatible endpoint for API keys. Stateless per request:
 * check key + limits -> sign with the user's API wallet (SIWX) -> forward to
 * Venice -> meter real usage -> charge the key. Prompts are never stored or logged.
 */
// Room for a few base64 screenshots; well inside a Worker's memory (the body is parsed and measured once more).
const MAX_BODY = 8 * 1024 * 1024;

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
  const deadline = Date.now() + BODY_TOTAL_MS; // a slow sender can't hold its share of the budget open
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tooSlow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("The request body took too long to arrive."), { status: 408 })), Math.max(0, Math.min(BODY_IDLE_MS, deadline - Date.now())));
    });
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await Promise.race([reader.read(), tooSlow]);
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const { done, value } = chunk;
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

/**
 * A Worker isolate has limited memory and each request holds several copies of its body. Large
 * bodies share a per-isolate budget, so a few at once get a retryable 503 instead of taking down
 * everyone's in-flight streams. Ordinary requests are never affected.
 */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const BODY_IDLE_MS = 30_000;
const BODY_TOTAL_MS = 120_000;
const LARGE_BODY_BYTES = 1024 * 1024;
let bufferedBytes = 0;
const largeBodyKeys = new Set<string>();

/** At most one large body per key, so one key can't hold the whole budget. */
export function takeBodyBudget(bytes: number, keyId: string): (() => void) | null {
  const large = bytes > LARGE_BODY_BYTES;
  if (large && (largeBodyKeys.has(keyId) || bufferedBytes + bytes > MAX_BUFFERED_BYTES)) return null;
  if (large) largeBodyKeys.add(keyId);
  bufferedBytes += bytes;
  return () => {
    bufferedBytes -= bytes;
    if (large) largeBodyKeys.delete(keyId);
  };
}

const serverBusy = () => oaiError(503, "Too many large requests at once. Retry in a moment.", "busy");

export async function handleChat(req: Request): Promise<Response> {
  let release: (() => void) | null = null;
  try {
    // The key comes first, so nobody without one can make us buffer and parse a large body.
    const rec = await authorize(bearer(req), null);
    const declared = Number(req.headers.get("content-length") ?? 0) || 0;
    if (declared > MAX_BODY) return oaiError(413, "Request body too large.", "too_large"); // not retryable, so before the budget
    release = takeBodyBudget(declared, rec.id);
    if (!release) return serverBusy();
    let text = await readBody(req);
    if (text === null) return oaiError(413, "Request body too large.", "too_large");
    if (!declared) {
      release = takeBodyBudget(text.length, rec.id); // no content-length: count what actually arrived
      if (!release) return serverBusy();
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text);
    } catch {
      return oaiError(400, "Request body is not valid JSON.", "bad_json");
    }
    text = ""; // the parsed body is all we need from here; don't hold a second copy
    if (!body || typeof body !== "object" || Array.isArray(body)) return oaiError(400, "Request body must be a JSON object.", "bad_json");
    const def = resolveModel(body.model);
    if (!def) return oaiError(400, `Unknown model "${String(body.model).slice(0, 80)}". GET /v1/models lists the allowed ones.`, "unknown_model");
    const bad = checkBody(body);
    if (bad) return oaiError(400, bad, "bad_request");

    assertModelAllowed(rec, def.key);
    const venice = veniceForApiWallet(await apiWalletAccount(rec.uid));
    const live = await livePrices(venice);

    return def.e2ee ? await e2ee(rec, venice, def, body, live) : await passthrough(rec, venice, def, body, live);
  } catch (e) {
    return toResponse(e);
  } finally {
    release?.();
  }
}

/**
 * The one output limit for a request: what the client asked for (max_completion_tokens,
 * else max_tokens), or else the model's own maximum, never above the model's maximum or
 * MAX_OUTPUT_TOKENS. It sizes the reservation AND is what Venice receives (both fields),
 * so the reservation is always an upper bound on what can be generated (audit V2-01).
 */
export function outputLimit(def: ModelDef, body: Record<string, unknown>): number {
  const asked = body.max_completion_tokens ?? body.max_tokens; // validated as 1..MAX_OUTPUT_TOKENS by checkBody
  const cap = Math.min(def.maxOutputTokens, MAX_OUTPUT_TOKENS);
  return typeof asked === "number" && Number.isInteger(asked) && asked >= 1 ? Math.min(asked, cap) : cap;
}

/** Tokens charged per image part in the estimate (remote image URLs are short but cost a lot). */
const IMAGE_TOKENS = 4_096;
/** UTF-8 byte length without allocating a copy (bodies can be several MB). */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : c >= 0xdc00 && c <= 0xdfff ? 0 : 3;
  }
  return n;
}

/**
 * Upper bound on prompt tokens, from what we send: the UTF-8 byte length of the
 * messages and tool definitions (byte-level BPE never needs more than one token per
 * byte), plus a flat charge per image part (audit R-01). It over-estimates ordinary
 * text several times; that's corrected as soon as Venice reports usage.
 */
export function promptTokenBound(body: Record<string, unknown>): number {
  // Messages, tools, and any other text-bearing field we forward (response_format schemas, functions, ...).
  const { messages = [], tools = [], model: _model, ...rest } = body;
  const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null && (typeof v === "object" || typeof v === "string")));
  const text = JSON.stringify(messages) + JSON.stringify(tools) + (Object.keys(extra).length ? JSON.stringify(extra) : "");
  let images = 0;
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    const content = (m as { content?: unknown })?.content;
    if (Array.isArray(content)) for (const part of content) if (/image/.test(String((part as { type?: unknown })?.type ?? ""))) images++;
  }
  return utf8Length(text) + images * IMAGE_TOKENS;
}

/**
 * Up-front reservation: a client that aborts before the final usage chunk must still
 * be charged. Both halves are upper bounds: prompt (promptTokenBound) + the request's
 * output limit (outputLimit), at live prices. Corrected to the real cost when usage arrives.
 */
export function reserve(def: ModelDef, body: Record<string, unknown>, live: LivePrices): number {
  return Math.max(0, costUsd(def, { prompt_tokens: promptTokenBound(body), completion_tokens: outputLimit(def, body) }, live) ?? 0);
}

/**
 * Pass an OpenAI-style SSE stream through untouched, reporting each usage object
 * to `onUsage` as it goes by, with `final` set when it's the request's last word:
 * usage on a chunk with a finish_reason, or [DONE] / the end of the stream after any
 * usage. Usage anywhere else (including an early "choices: []" chunk, which some
 * upstreams send with the prompt count) is a running total (audit R-02). Reporting happens while the
 * stream flows, right after forwarding the chunk, not at the end: clients such as
 * opencode hang up right after [DONE], which cancels the pipe, so an end-of-stream
 * hook alone would never run. No usage at all reports nothing (the reservation stays).
 */
export function meterStream(onUsage: (usage: unknown, final: boolean) => Promise<void>): TransformStream<Uint8Array, Uint8Array> {
  let buf = "";
  let last: unknown;
  let finished = false;
  let sawFinish = false; // OpenAI sends usage on its own chunk just after the finish_reason chunk
  const decoder = new TextDecoder();
  const report = async (usage: unknown, final: boolean) => {
    if (finished) return;
    if (final) finished = true;
    await onUsage(usage, final).catch(() => {});
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, ctl) {
      ctl.enqueue(chunk); // forward first so the client isn't kept waiting on our database write
      if (finished) return;
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (/^data:\s*\[DONE\]$/.test(line)) {
          if (last !== undefined) await report(last, true);
          continue;
        }
        if (!line.startsWith("data:")) continue;
        if (!line.includes('"usage"') && !/"finish_reason"\s*:\s*"/.test(line)) continue;
        try {
          const ev = JSON.parse(line.slice(5)) as { usage?: unknown; choices?: Array<{ finish_reason?: unknown }> };
          if (ev.choices?.some((c) => c?.finish_reason != null)) sawFinish = true;
          if (!ev.usage || typeof ev.usage !== "object") continue; // "usage": null on ordinary chunks
          last = ev.usage;
          await report(ev.usage, sawFinish);
        } catch {}
      }
    },
    async flush() {
      if (last !== undefined) await report(last, true); // the stream ran to the end
    },
  });
}

/**
 * Assemble an OpenAI-style streamed reply into the non-streamed response shape. A stream that stops
 * without a finish_reason or [DONE] is an error, never a short reply passed off as complete.
 * `noContent` on the error says nothing had been generated yet.
 */
export async function collectStream(res: Response): Promise<Record<string, unknown>> {
  if (!/event-stream/i.test(res.headers.get("content-type") ?? "")) return (await res.json()) as Record<string, unknown>;
  type ToolCall = { id?: string; type: string; function: { name: string; arguments: string } };
  type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; refusal?: string | null; tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }> };
  const tools: ToolCall[] = [];
  const logprobs: unknown[] = [];
  let text = "";
  let reasoning = "";
  let refusal = "";
  let finish: unknown = null;
  let done = false;
  let usage: unknown;
  let generated = false;
  let first: { id?: unknown; created?: unknown; system_fingerprint?: unknown } | undefined;
  const fail = (message: string) => Object.assign(new HttpError(502, message, "stream"), { noContent: !generated });
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return void (done = true);
    if (!data) return;
    let ev: { id?: unknown; created?: unknown; system_fingerprint?: unknown; error?: unknown; usage?: unknown; choices?: Array<{ finish_reason?: unknown; delta?: Delta; logprobs?: { content?: unknown[] } | null }> };
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.error) throw fail(JSON.stringify(ev.error).slice(0, 300));
    first ??= ev;
    if (ev.usage) usage = ev.usage;
    const choice = ev.choices?.[0];
    if (choice?.finish_reason != null) finish = choice.finish_reason;
    if (choice?.logprobs?.content) logprobs.push(...choice.logprobs.content);
    const d = choice?.delta;
    if (!d) return;
    if (d.content) text += d.content;
    if (d.reasoning_content ?? d.reasoning) reasoning += d.reasoning_content ?? d.reasoning;
    if (d.refusal) refusal += d.refusal;
    if (d.content || d.reasoning_content || d.reasoning || d.tool_calls?.length) generated = true;
    for (const t of d.tool_calls ?? []) {
      // A continuation without an index belongs to the call in progress.
      const at = t.index ?? (t.id || !tools.length ? tools.length : tools.length - 1);
      const call = (tools[at] ??= { type: "function", function: { name: "", arguments: "" } });
      if (t.id) call.id = t.id;
      if (t.type) call.type = t.type;
      if (t.function?.name) call.function.name += t.function.name;
      if (t.function?.arguments) call.function.arguments += t.function.arguments;
    }
  };
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (ended) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        take(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    }
    take(buf.trim());
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!first) throw fail("Venice sent an empty stream.");
  if (finish === null && !done) throw fail("Venice's reply was cut off before it finished.");
  const message: Record<string, unknown> = { role: "assistant", content: text || (tools.length ? null : "") };
  if (reasoning) message.reasoning_content = reasoning;
  if (refusal) message.refusal = refusal;
  if (tools.length) message.tool_calls = tools.filter(Boolean);
  return {
    id: first.id,
    object: "chat.completion",
    created: first.created ?? Math.floor(Date.now() / 1000),
    ...(first.system_fingerprint ? { system_fingerprint: first.system_fingerprint } : {}),
    choices: [{ index: 0, message, finish_reason: finish ?? "stop", ...(logprobs.length ? { logprobs: { content: logprobs } } : {}) }],
    usage,
  };
}

const FAST_FAILURE_MS = 10_000;

/**
 * A reservation is released only when Venice can't have generated anything worth billing: it refused
 * the request, we never sent it, or it failed within seconds. After a timeout or a late 5xx it may
 * still be generating and billing the API wallet, so the key keeps the charge (audit B-01).
 */
export function nothingGenerated(e: unknown, elapsedMs = Infinity): boolean {
  if (e instanceof VeniceInsufficientBalance) return true;
  if ((e as { beforeRequest?: unknown })?.beforeRequest === true) return true;
  if (e instanceof HttpError && e.status >= 400 && e.status < 500) return true;
  // A quick 500/502/503 or a failed connection is an outage, not an abandoned generation: don't bill retries for it.
  if (elapsedMs > FAST_FAILURE_MS) return false;
  return e instanceof TypeError || (e instanceof HttpError && [500, 502, 503].includes(e.status));
}

/** Call Venice; if credit ran out but USDC sits on the API wallet, top it up and retry once. */
async function withTopUp<T>(rec: KeyRecord, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (!(e instanceof VeniceInsufficientBalance)) throw e;
    // If the top-up attempt itself fails (RPC down, etc.), report the real problem: out of credit.
    const swept = await sweepToCredit(rec.uid).catch((err: unknown) => {
      const x = err as { code?: unknown; status?: unknown; name?: unknown };
      console.warn("auto top-up failed", { code: x?.code ?? x?.name, status: x?.status }); // no prompt, no message text
      return { toppedUpUsd: 0 };
    });
    if (swept.toppedUpUsd > 0) return call();
    throw e;
  }
}

async function passthrough(rec: KeyRecord, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>, live: LivePrices): Promise<Response> {
  const keepAlive = keepAliveForRequest();
  const limit = outputLimit(def, body);
  const upstream: Record<string, unknown> = { ...body, model: def.id, venice_parameters: veniceParams(body), max_tokens: limit, max_completion_tokens: limit };
  delete upstream.max_output_tokens; // no other output-limit alias may compete with ours
  // Every request reserves an estimate first, so a reply without usage (or an aborted stream) is still charged.
  const held = reserve(def, body, live);
  const day = await recordSpend(rec, held);
  const started = Date.now();

  if (!body.stream) {
    // Streamed upstream even here: usage always arrives, and only silence (not a slow reply) can time out.
    let res: Response;
    try {
      res = await withTopUp(rec, () => venice.chatStream({ ...upstream, stream_options: { include_usage: true } }));
    } catch (e) {
      if (nothingGenerated(e, Date.now() - started)) await recordSpend(rec, -held, day);
      throw e;
    }
    let json: Record<string, unknown>;
    try {
      json = await collectStream(res);
    } catch (e) {
      // Generation has started, so a failure keeps the reservation, unless it failed at once with nothing produced.
      if ((e as { noContent?: unknown }).noContent === true && Date.now() - started <= FAST_FAILURE_MS) await recordSpend(rec, -held, day);
      throw e;
    }
    const actual = costUsd(def, json.usage as Parameters<typeof costUsd>[1], live);
    // The reply is already paid for: a failed correction keeps the reservation, never a 502.
    if (actual !== undefined) await recordSpend(rec, actual - held, day).catch(() => {});
    return Response.json({ ...json, model: def.key });
  }

  upstream.stream_options = { include_usage: true };
  let res: Response;
  try {
    res = await withTopUp(rec, () => venice.chatStream(upstream));
  } catch (e) {
    if (nothingGenerated(e, Date.now() - started)) await recordSpend(rec, -held, day);
    throw e;
  }
  // Pass the SSE stream through untouched. Running usage can only raise the charge above the
  // reservation; the final usage sets it to the real cost (audit V2-05).
  let charged = held;
  const tap = meterStream(async (usage, final) => {
    const actual = costUsd(def, usage as Parameters<typeof costUsd>[1], live);
    if (actual === undefined || (!final && actual <= charged)) return;
    const delta = actual - charged;
    charged = actual;
    const write = recordSpend(rec, delta, day);
    keepAlive(write); // a hang-up mustn't cancel the write (audit V2-07)
    await write;
  });
  return new Response(res.body!.pipeThrough(tap), {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" },
  });
}

/** TEE models: attested E2EE between our server and the enclave (server-side client; tools dropped). */
async function e2ee(rec: KeyRecord, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>, live: LivePrices): Promise<Response> {
  const keepAlive = keepAliveForRequest();
  const chat = new VeniceChat({ venice });
  const messages = fold((body.messages as Array<{ role: string; content: unknown }>) ?? []);
  const held = reserve(def, body, live);
  const day = await recordSpend(rec, held);
  const started = Date.now();
  const hangup = new AbortController(); // a client that leaves ends the upstream request too
  let deltas: Awaited<ReturnType<VeniceChat["stream"]>>["deltas"];
  try {
    ({ deltas } = await withTopUp(rec, () =>
      chat.stream({
        mode: "private",
        model: def.key,
        messages,
        maxTokens: outputLimit(def, body),
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        signal: hangup.signal,
      }),
    ));
  } catch (e) {
    if (nothingGenerated(e, Date.now() - started)) await recordSpend(rec, -held, day);
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
    if (cost !== undefined) await recordSpend(rec, cost - held, day).catch(() => {});
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
        try {
          send({}, "stop");
          ctl.enqueue(enc.encode("data: [DONE]\n\n"));
        } catch {
          // the client hung up at the very end; the reply was generated, so still charge it
        }
        // Settle after the last bytes went out but before closing, so it runs even if the
        // client hangs up right after [DONE]. A stream that broke off earlier never gets here
        // and keeps the reservation.
        if (cost !== undefined) {
          const write = recordSpend(rec, cost - held, day);
          keepAlive(write);
          await write.catch(() => {});
        }
      } catch (e) {
        if (!hangup.signal.aborted) throw e; // cut off by the client: the reservation stands
      } finally {
        try {
          ctl.close();
        } catch {}
      }
    },
    cancel() {
      hangup.abort();
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
  const res = oaiError(status && status >= 400 && status < 600 ? status : 502, (e as Error)?.message?.slice(0, 300) ?? "Upstream error", "upstream_error");
  // The key kept its reservation; an SDK's silent retry would hold another one.
  if ((e as { noContent?: unknown })?.noContent === false || (e as Error)?.name === "TimeoutError") res.headers.set("x-should-retry", "false");
  return res;
}
