"use client";

import { PRIVACY_MODES } from "@pay/rail/browser";
import { useEffect, useRef, useState } from "react";
import { brand } from "../brand";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const DEFAULT_MODEL = PRIVACY_MODES.anonymous.chatModel;

const TOOLS = {
  opencode: {
    label: "opencode",
    text: (id: string) => `// ~/.config/opencode/opencode.jsonc  (then: export ${id.toUpperCase()}_API_KEY=<your local API key>)
{
  "$schema": "https://opencode.ai/config.json",
  "model": "${id}/${DEFAULT_MODEL}",
  "providers": {
    "${id}": {
      "name": "${brand.name}",
      "env": ["${id.toUpperCase()}_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "${BASE}" },
      "models": {
        "large-v2": { "name": "Abliterated Large V2" },
        "large-flash": { "name": "Abliterated Large Flash" },
        "deepseek-1017-uncensored": { "name": "DeepSeek V4.1 Flash 1017 Uncensored" }
      }
    }
  }
}`,
  },
  generic: {
    label: "Cursor & others",
    text: () => `Any tool with an "OpenAI-compatible" or "custom OpenAI base URL" setting:

  Base URL   ${BASE}
  API key    <your local API key, printed by the serve command>
  Model      ${DEFAULT_MODEL}   (full list: GET ${BASE}/models)`,
  },
  sillytavern: {
    label: "SillyTavern",
    text: () => `API Connections → Chat Completion → Custom (OpenAI-compatible)

  Custom Endpoint (Base URL)   ${BASE}
  Custom API Key               <your local API key>
  Model                        venice-roleplay   or   large-v2`,
  },
  sdk: {
    label: "OpenAI SDK",
    text: () => `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${BASE}", apiKey: process.env.LOCAL_PROXY_KEY });
const r = await client.chat.completions.create({
  model: "${DEFAULT_MODEL}",
  messages: [{ role: "user", content: "Hello" }],
});`,
  },
} as const;

export function EditorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [reveal, setReveal] = useState(false);
  const [tool, setTool] = useState<keyof typeof TOOLS>("opencode");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) setReveal(false);
  }, [open]);

  const copy = (t: string) => void navigator.clipboard.writeText(t);
  const id = brand.repo;

  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} onCancel={onClose}>
      <div className={s.head}>
        <h2 className={s.title}>Use in your editor</h2>
        <button className={s.x} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className={s.p}>
        Run a small proxy on your own computer. Your tools talk to it on localhost; it signs each request with your inference wallet and spends your credit.
        Nothing goes through us.
      </p>

      <div className={s.label}>1. Start the proxy (from the repo)</div>
      <pre className={s.code}>{`npm run proxy -- login     # paste the key from step 2 (input hidden)
npm run proxy -- serve     # prints your local API key`}</pre>

      <div className={s.label}>2. Your inference wallet key</div>
      {!w.inferenceKey ? (
        <p className={s.fine}>Unlock your wallet first.</p>
      ) : reveal ? (
        <>
          <code className={s.addr}>{w.inferenceKey}</code>
          <button className={s.copyBtn} onClick={() => copy(w.inferenceKey!)}>
            Copy
          </button>
          <p className={s.warn}>
            Anyone with this key can spend your credit. Paste it only into the proxy&apos;s login prompt, never into a website or chat.
          </p>
        </>
      ) : (
        <button className={s.secondary} onClick={() => setReveal(true)}>
          Reveal key
        </button>
      )}

      <div className={s.label}>3. Point your tool at it</div>
      <div className={s.tabs} role="tablist">
        {(Object.keys(TOOLS) as Array<keyof typeof TOOLS>).map((k) => (
          <button key={k} role="tab" aria-selected={tool === k} className={`${s.tab} ${tool === k ? s.tabOn : ""}`} onClick={() => setTool(k)}>
            {TOOLS[k].label}
          </button>
        ))}
      </div>
      <pre className={s.code}>{TOOLS[tool].text(id)}</pre>
      <button className={s.copyBtn} onClick={() => copy(TOOLS[tool].text(id))}>
        Copy
      </button>

      <p className={s.fine}>
        The proxy only listens on 127.0.0.1, needs its local API key on every request, and refuses requests from web pages. Agentic tools (tool calls) work with
        every model except the end-to-end encrypted ones, which can&apos;t carry tool definitions. Prompts are never logged.
      </p>
    </dialog>
  );
}
