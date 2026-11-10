import { silentLogger, type Logger } from "../log.ts";
import { VeniceInsufficientBalance, type VeniceClient } from "../venice/client.ts";
import { INTEL_CHECK, attest, decryptStream, e2eeRequest, newSession, withQuoteVerdict, type AttestationReport, type QuoteVerifier, type StreamUsage } from "../venice/e2ee.ts";
import { RailError } from "../util.ts";
import { costUsd, parseVenicePrices, resolveModel, type LivePrices, type ModelDef, type PrivacyMode } from "./models.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  mode: PrivacyMode;
  /** Key in MODELS; defaults to the mode's chat model. */
  model?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  /** Skip the model's thinking phase (cheaper/faster for short tasks). */
  noThinking?: boolean;
  /** Ask for JSON; uses json_schema when supported, else prompt instructions (caller validates). */
  json?: { name: string; schema: Record<string, unknown> };
  /** Truly private only: Intel's check couldn't run even after a retry. Return true to send anyway. */
  confirmUnverified?: () => boolean | Promise<boolean>;
  /** The user already agreed for this conversation: no retry, no asking again. */
  unverifiedAccepted?: boolean;
  /** Aborting ends the request and the stream, so Venice stops generating (and billing). */
  signal?: AbortSignal;
}

export type ChatDelta = { type: "text" | "reasoning"; text: string } | { type: "usage"; usage: StreamUsage; costUsd?: number };

export interface ChatMeta {
  model: ModelDef;
  mode: PrivacyMode;
  e2ee: boolean;
  attestation?: AttestationReport;
  /** Count of plaintext chunks received on an E2EE request (should be 0). */
  plaintextChunks: number;
}

export interface ChatResult extends ChatMeta {
  text: string;
  reasoning: string;
  costUsd?: number;
}

export interface VeniceChatOptions {
  venice: VeniceClient;
  /** Called on HTTP 402; should refill credit and resolve true if a retry makes sense. */
  onLowBalance?: () => Promise<boolean>;
  /** How long one attestation is reused before re-attesting (default 10 min). */
  attestationTtlMs?: number;
  /** Optional local verification of the Intel quote's signature chain (the website runs it in a sandboxed worker). */
  verifyQuote?: QuoteVerifier;
  log?: Logger;
}

/**
 * One chat entry point for both modes.
 *  - anonymous: plain streaming request.
 *  - private:   fresh attestation (cached briefly) -> E2EE request -> decrypt stream.
 * Refuses rather than downgrading: a private request never goes out in plaintext.
 */
export class VeniceChat {
  private readonly o: VeniceChatOptions;
  private readonly log: Logger;
  private readonly attestations = new Map<string, AttestationReport>();
  private readonly inflight = new Map<string, Promise<AttestationReport>>();
  private prices?: { at: number; map: LivePrices };

  constructor(opts: VeniceChatOptions) {
    this.o = opts;
    this.log = (opts.log ?? silentLogger).child("chat");
  }

  async livePrices(): Promise<LivePrices> {
    if (this.prices && Date.now() - this.prices.at < 10 * 60_000) return this.prices.map;
    try {
      this.prices = { at: Date.now(), map: parseVenicePrices((await this.o.venice.models("text")) as never) };
    } catch (e) {
      this.log.warn("price fetch failed; using fallback prices", { err: String(e) });
      this.prices = { at: Date.now(), map: new Map() };
    }
    return this.prices.map;
  }

  /** Fresh-nonce attestation for a TEE model, reused for attestationTtlMs. */
  async attestation(model: ModelDef, force = false): Promise<AttestationReport> {
    const cached = this.attestations.get(model.id);
    const ttl = this.o.attestationTtlMs ?? 10 * 60_000;
    if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < ttl) return cached;
    // One attestation in flight per model: a prefetch (switching to Truly private) and a send share it.
    const pending = this.inflight.get(model.id);
    if (pending && !force) return pending;
    const run = (async () => {
      let report = await attest({ model: model.id, authHeaders: (u) => this.o.venice.authHeaders(u) });
      if (this.o.verifyQuote && report.quoteHex) {
        report = withQuoteVerdict(
          report,
          await this.o.verifyQuote(report.quoteHex).catch((e: unknown) => ({ status: "unavailable" as const, detail: `Couldn't check right now (${(e as Error)?.message ?? "error"}).` })),
        );
      }
      // Only a clean result is remembered: "couldn't check" or a failure is re-tried on the next send.
      if (report.ok && report.checks.find((c) => c.name === INTEL_CHECK)?.status !== "unavailable") this.attestations.set(model.id, report);
      return report;
    })();
    this.inflight.set(model.id, run);
    try {
      return await run;
    } finally {
      this.inflight.delete(model.id);
    }
  }

  /** Stream deltas; `meta` resolves once the request is accepted. */
  async stream(req: ChatRequest): Promise<{ meta: ChatMeta; deltas: AsyncGenerator<ChatDelta> }> {
    const model = resolveModel(req.mode, req.model);
    const messages = this.withJsonInstructions(req, model);
    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      // Both fields, so the limit holds whichever one the upstream honours.
      ...(req.maxTokens ? { max_tokens: req.maxTokens, max_completion_tokens: req.maxTokens } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      venice_parameters: { include_venice_system_prompt: false, ...(req.noThinking ? { disable_thinking: true } : {}) },
      stream_options: { include_usage: true },
    };
    if (req.json && model.structuredOutputs) {
      body.response_format = { type: "json_schema", json_schema: { ...req.json, strict: true } };
    }

    if (!model.e2ee) {
      const res = await this.withRefill(() => this.o.venice.chatStream(body, {}, req.signal));
      const meta: ChatMeta = { model, mode: req.mode, e2ee: false, plaintextChunks: 0 };
      return { meta, deltas: withCost(plainDeltas(res), model, await this.livePrices()) };
    }

    const attest = (force = false) =>
      abortable(this.attestation(model, force), req.signal).catch((e: unknown) => {
        throw beforeRequest(e);
      });
    const unverified = (r: AttestationReport) => r.checks.find((c) => c.name === INTEL_CHECK)?.status === "unavailable";
    let report = await attest();
    if (req.confirmUnverified && !req.unverifiedAccepted && unverified(report)) {
      report = await attest(true);
      if (unverified(report) && !(await req.confirmUnverified())) {
        throw beforeRequest(new RailError("INTEL_UNAVAILABLE", "Not sent: Intel's check couldn't run. Try again in a moment."));
      }
    }
    if (!report.ok) throw beforeRequest(new Error(`attestation failed for ${model.label}; not sending`));
    req.signal?.throwIfAborted(); // stopped while attesting: the paid request never goes out
    const session = newSession(report);
    const enc = e2eeRequest(session, body as never);
    const res = await this.withRefill(() => this.o.venice.chatStream(enc.body, enc.headers, req.signal));
    const meta: ChatMeta = { model, mode: req.mode, e2ee: true, attestation: report, plaintextChunks: 0 };
    const deltas = (async function* () {
      try {
        for await (const d of decryptStream(res, session)) {
          if (d.field === "usage") {
            yield { type: "usage", usage: d.usage } as ChatDelta;
            continue;
          }
          if (!d.encrypted) meta.plaintextChunks++;
          yield { type: d.field === "reasoning" ? "reasoning" : "text", text: d.text } as ChatDelta;
        }
      } finally {
        session.clientPriv.fill(0);
      }
    })();
    return { meta, deltas: withCost(deltas, model, await this.livePrices()) };
  }

  /** Non-streaming convenience: collect the whole reply. */
  async complete(req: ChatRequest): Promise<ChatResult> {
    const { meta, deltas } = await this.stream(req);
    let text = "";
    let reasoning = "";
    let cost: number | undefined;
    for await (const d of deltas) {
      if (d.type === "text") text += d.text;
      else if (d.type === "reasoning") reasoning += d.text;
      else if (d.type === "usage") cost = d.costUsd;
    }
    return { ...meta, text, reasoning, costUsd: cost };
  }

  private withJsonInstructions(req: ChatRequest, model: ModelDef): ChatMessage[] {
    if (!req.json || model.structuredOutputs) return req.messages;
    const instr: ChatMessage = {
      role: "system",
      content: `Respond with ONLY a JSON object matching this JSON Schema, no prose, no code fences:\n${JSON.stringify(req.json.schema)}`,
    };
    return [instr, ...req.messages];
  }

  private async withRefill(call: () => Promise<Response>): Promise<Response> {
    try {
      return await call();
    } catch (e) {
      if (e instanceof VeniceInsufficientBalance && this.o.onLowBalance && (await this.o.onLowBalance())) return call();
      throw e;
    }
  }
}

/** Marks a failure that happened before any paid request was sent, so a caller holding a reservation can release it. */
function beforeRequest(e: unknown): unknown {
  return Object.assign(e as object, { beforeRequest: true });
}

/** Stop shouldn't have to wait for a slow attestation (which keeps running for the next send). */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    p.then(resolve, reject);
  });
}

async function* plainDeltas(res: Response): AsyncGenerator<ChatDelta> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const chunk = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>; usage?: StreamUsage };
          if (chunk.usage) yield { type: "usage", usage: chunk.usage };
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.reasoning_content) yield { type: "reasoning", text: delta.reasoning_content };
          if (delta?.content) yield { type: "text", text: delta.content };
        } catch {}
      }
    }
  } finally {
    await reader.cancel().catch(() => {}); // a consumer that stops early must hang up, or Venice keeps generating
  }
}

/** Attach a USD cost (usage x live price) to the usage delta. */
async function* withCost(src: AsyncGenerator<ChatDelta>, model: ModelDef, live: LivePrices): AsyncGenerator<ChatDelta> {
  for await (const d of src) {
    if (d.type === "usage") yield { ...d, costUsd: costUsd(model, d.usage, live) };
    else yield d;
  }
}

export { costUsd };
