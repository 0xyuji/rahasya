"use client";

import { PRIVACY_MODES } from "@pay/rail/browser";
import { useEffect, useRef, useState } from "react";
import { brand } from "../brand";
import { CodeBlock, CopyButton, CopyRow, DialogHead } from "./dialog-parts";
import { opencodeConfig } from "./opencode-config";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const DEFAULT_MODEL = PRIVACY_MODES.anonymous.chatModel;
const NPX = "npx rahasya@0.1.1"; // pinned: a test keeps it in step with packages/proxy/npm/package.json

const TOOLS = {
  opencode: {
    label: "opencode",
    text: (_id: string) => opencodeConfig({ baseURL: BASE, keyHint: "<your local API key>" }),
  },
  generic: {
    label: "Other tools",
    text: () => `Any tool with an "OpenAI-compatible" or "custom OpenAI base URL" setting.
(Not Cursor: it sends requests from its own servers, which can't reach your machine.)

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
  const [tool, setTool] = useState<keyof typeof TOOLS>("opencode");
  const [sha, setSha] = useState<string | null>(null);

  // The download's SHA-256, published next to it at build time.
  useEffect(() => {
    if (!open || sha) return;
    fetch("/rahasya.mjs.sha256")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const h = t.trim().split(/\s+/)[0] ?? "";
        if (/^[0-9a-f]{64}$/.test(h)) setSha(h);
      })
      .catch(() => {});
  }, [open, sha]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const id = brand.repo;
  // Same value on the server and the first client render (no hydration mismatch), then the real origin.
  const [site, setSite] = useState(`https://${brand.domain}`);
  useEffect(() => setSite(window.location.origin), []);
  const download = `curl -fsSLO ${site}/rahasya.mjs\nnode rahasya.mjs`;

  return (
    <dialog ref={ref} className={`${s.dialog} ${s.dialogWide}`} onClose={onClose} onCancel={onClose}>
      <DialogHead title="Local proxy" onClose={onClose} />
      <p className={s.p}>
        Run a small proxy on your own computer. Your tools talk to it on localhost; it signs each request with your inference wallet and spends your credit.
        Nothing goes through us.
      </p>

      <div className={s.label}>1. Copy your inference wallet key</div>
      {!w.inferenceKey ? (
        !w.source ? (
          <div className={s.row}>
            <button className={s.secondary} onClick={() => (onClose(), w.connectEvmOrSolana())}>
              Connect wallet to get your key
            </button>
            <button className={s.secondary} onClick={() => (onClose(), void w.connectNear())}>
              NEAR wallet
            </button>
          </div>
        ) : (
          <button className={s.secondary} onClick={() => void w.unlock()} disabled={w.busy}>
            {w.busy ? "Check your wallet…" : "Unlock to get your key"}
          </button>
        )
      ) : (
        <>
          <CopyButton text={w.inferenceKey} label="Copy key" className={s.secondary} />
          <p className={s.warn}>
            The key is copied, never shown. Anyone with it can spend your credit, so paste it only into the proxy&apos;s prompt, never into a website or chat.
          </p>
        </>
      )}

      <div className={s.label}>2. Start the proxy and paste the key (needs Node.js 22 or newer)</div>
      <CopyRow text={NPX} />
      <p className={s.fine}>
        It asks for the key. The input is hidden, so nothing appears when you paste: paste once and press Enter. The key is saved on your computer, and the proxy
        starts and prints a <strong>Base URL</strong> and a local <strong>API key</strong>. Keep that terminal open. Later runs skip the question.
      </p>
      <div className={s.label}>Or download it as one readable file</div>
      <CodeBlock label="Terminal" text={download} />
      <p className={s.fine}>
        One readable file, built from our repo. Add <code>--help</code> to see the other commands.
        {sha && (
          <>
            {" "}
            Check the download: <code>shasum -a 256 rahasya.mjs</code> should print <code className={s.hash}>{sha}</code>.
          </>
        )}
      </p>

      <div className={s.label}>3. Point your tool at the Base URL, with the local API key</div>
      <div className={s.tabs} role="tablist">
        {(Object.keys(TOOLS) as Array<keyof typeof TOOLS>).map((k) => (
          <button key={k} role="tab" aria-selected={tool === k} className={`${s.tab} ${tool === k ? s.tabOn : ""}`} onClick={() => setTool(k)}>
            {TOOLS[k].label}
          </button>
        ))}
      </div>
      <CodeBlock label={TOOLS[tool].label} text={TOOLS[tool].text(id)} />

      <p className={s.fine}>
        The proxy only listens on 127.0.0.1, needs its local API key on every request, and refuses requests from web pages. Agentic tools (tool calls) work with
        every model except the end-to-end encrypted ones, which can&apos;t carry tool definitions. Prompts are never logged.
      </p>
    </dialog>
  );
}
