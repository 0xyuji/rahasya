import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MODELS, RailError, VeniceChat, VeniceInsufficientBalance, type ChatMessage, type ModelDef, type VeniceClient } from "@pay/rail";

/**
 * Local OpenAI-compatible proxy. Binds to 127.0.0.1, requires a local bearer
 * token, refuses browser-originated requests, and never logs prompt content.
 *
 *  - anonymous / Venice-hosted models: request body passed through (tools work),
 *    signed with the user's inference wallet (SIWX), streamed back verbatim.
 *  - TEE (e2ee-*) models: attested + end-to-end encrypted; history folded into one
 *    encrypted system message; tools dropped (E2EE can't carry them).
 */
export interface ProxyOptions {
  venice: VeniceClient;
  token: string;
  /** Where to tell users to add credit when they run out. */
  creditUrl?: string;
  log?: (line: string) => void;
}

const MAX_BODY = 4 * 1024 * 1024;

export function createProxy(o: ProxyOptions): Server {
  const chat = new VeniceChat({ venice: o.venice });
  const log = o.log ?? (() => {});
  const want = Buffer.from(o.token);

  return createServer(async (req, res) => {
    const t0 = Date.now();
    try {
      // Browsers attach Origin; editor tools and SDKs don't. Refusing it blocks
      // any website from driving this localhost proxy with your credit.
      if (req.headers.origin) return send(res, 403, err("Browser requests are not allowed. Use this from your editor or CLI tools."));
      const got = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
      if (got.length !== want.length || !timingSafeEqual(got, want)) {
        return send(res, 401, err("Missing or wrong token. Use the token printed by `naisho serve` as the API key."));
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        return send(res, 200, { object: "list", data: Object.values(MODELS).map(toOpenAiModel) });
      }
      if (req.method === "POST" && (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")) {
        const body = await readJson(req);
        const def = resolve(body.model);
        if (!def) return send(res, 400, err(`Unknown model "${body.model}". GET /v1/models lists the allowed ones.`));
        if (def.e2ee) await e2ee(res, chat, def, body, log);
        else await passthrough(res, o.venice, def, body);
        log(`${def.key} ${def.e2ee ? "(e2ee) " : ""}${Date.now() - t0}ms`);
        return;
      }
      return send(res, 404, err("Not found. This proxy serves /v1/models and /v1/chat/completions."));
    } catch (e) {
      if (e instanceof VeniceInsufficientBalance) {
        return send(res, 402, err(`Out of credit.${o.creditUrl ? ` Add credit at ${o.creditUrl}` : ""}`, "insufficient_credit"));
      }
      const status = e instanceof RailError ? 400 : (e as { status?: number }).status ?? 502;
      log(`error ${status}: ${(e as Error).message?.slice(0, 160)}`);
      if (!res.headersSent) return send(res, status >= 400 && status < 600 ? status : 502, err((e as Error).message ?? "upstream error"));
      res.end();
    }
  });
}

function resolve(model: unknown): ModelDef | undefined {
  if (typeof model !== "string") return undefined;
  return MODELS[model] ?? Object.values(MODELS).find((m) => m.id === model);
}

function toOpenAiModel(m: ModelDef) {
  return { id: m.key, object: "model", created: 0, owned_by: "venice", name: m.label, venice_id: m.id, privacy: m.tier, e2ee: m.e2ee };
}

async function passthrough(res: ServerResponse, venice: VeniceClient, def: ModelDef, body: Record<string, unknown>) {
  const vp = (body.venice_parameters as Record<string, unknown> | undefined) ?? {};
  const upstream = { ...body, model: def.id, venice_parameters: { ...vp, include_venice_system_prompt: false } };
  if (body.stream) {
    const r = await venice.chatStream(upstream);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const reader = r.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } else {
    send(res, 200, await venice.chat({ ...upstream, stream: false }));
  }
}

async function e2ee(res: ServerResponse, chat: VeniceChat, def: ModelDef, body: Record<string, unknown>, log: (l: string) => void) {
  if (body.tools) log(`note: ${def.key} is end-to-end encrypted; tool definitions were dropped (E2EE can't carry them)`);
  const messages = foldForE2ee((body.messages as Array<{ role: string; content: unknown }>) ?? []);
  const { deltas } = await chat.stream({
    mode: "private",
    model: def.key,
    messages,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
  });
  const id = `chatcmpl-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);

  if (body.stream) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: def.key, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    chunk({ role: "assistant" });
    for await (const d of deltas) {
      if (d.type === "text") chunk({ content: d.text });
      else if (d.type === "reasoning") chunk({ reasoning_content: d.text });
    }
    chunk({}, "stop");
    res.end("data: [DONE]\n\n");
    return;
  }
  let text = "";
  let usage: unknown;
  for await (const d of deltas) {
    if (d.type === "text") text += d.text;
    else if (d.type === "usage") usage = d.usage;
  }
  send(res, 200, { id, object: "chat.completion", created, model: def.key, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage });
}

/** Venice E2EE encrypts only user/system roles: fold everything else into one encrypted system message. */
export function foldForE2ee(msgs: Array<{ role: string; content: unknown }>): ChatMessage[] {
  const text = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";
  const last = [...msgs].reverse().find((m) => m.role === "user");
  const prior = last ? msgs.slice(0, msgs.lastIndexOf(last)) : msgs;
  const out: ChatMessage[] = [];
  const transcript = prior
    .map((m) => `${m.role === "system" ? "System" : m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : `Tool (${m.role})`}: ${text(m.content)}`)
    .filter((l) => !/:\s*$/.test(l))
    .join("\n\n");
  if (transcript) out.push({ role: "system", content: `Conversation so far:\n\n${transcript}` });
  out.push({ role: "user", content: last ? text(last.content) : "" });
  return out;
}

function err(message: string, code = "proxy_error") {
  return { error: { message, type: code, code } };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new RailError("TOO_LARGE", "request body too large");
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RailError("BAD_JSON", "request body is not valid JSON");
  }
}
