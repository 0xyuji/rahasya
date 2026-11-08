"use client";

import { MODELS, PRIVACY_MODES } from "@pay/rail/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { brand } from "../brand";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";
import k from "./api-keys.module.css";

interface Account {
  apiWallet: string;
  creditUsd: number | null;
  idleUsdc: number | null;
}
interface KeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  expiresAt?: number;
  lastUsedAt?: number;
  limits: { dailyUsd?: number; totalUsd?: number };
  models: string[];
  spentTodayUsd: number;
  spentTotalUsd: number;
}
type Draft = { name: string; dailyUsd: string; totalUsd: string; models: string[]; expiryDays: string };
const EMPTY: Draft = { name: "", dailyUsd: "", totalUsd: "", models: [], expiryDays: "" };

const usd = (n?: number | null, d = 2) => (n === undefined || n === null ? "–" : `$${n.toFixed(d)}`);
const ago = (t?: number) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as T & { message?: string };
  if (!r.ok) throw Object.assign(new Error(j.message ?? `Request failed (${r.status})`), { status: r.status });
  return j;
}

export function ApiKeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [keys, setKeys] = useState<KeyView[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) (setFresh(null), setDraft(null), setEditing(null), setErr(null));
  }, [open]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [a, ks] = await Promise.all([api<Account>("/api/account"), api<{ keys: KeyView[] }>("/api/keys")]);
      setAccount(a);
      setKeys(ks.keys);
      setNeedsLogin(false);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedsLogin(true);
      else setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load, w.creditOpen]);

  async function signIn() {
    if (!w.source) return;
    setBusy(true);
    setErr(null);
    try {
      const chal = await api<{ id: string; message: string; nonce: string }>("/api/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ chain: w.source.chain, address: w.source.address }),
      });
      const proof = await w.signLogin(chal);
      await api("/api/auth/verify", { method: "POST", body: JSON.stringify(proof) });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toBody = (d: Draft) => ({
    name: d.name,
    limits: { dailyUsd: d.dailyUsd || undefined, totalUsd: d.totalUsd || undefined },
    models: d.models,
    expiresAt: d.expiryDays ? Date.now() + Number(d.expiryDays) * 86_400_000 : null,
  });

  async function save() {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await api(`/api/keys/${editing}`, { method: "PATCH", body: JSON.stringify(toBody(draft)) });
      } else {
        const r = await api<{ token: string; key: KeyView }>("/api/keys", { method: "POST", body: JSON.stringify(toBody(draft)) });
        setFresh({ token: r.token, name: r.key.name });
      }
      setDraft(null);
      setEditing(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (confirmDel !== id) return setConfirmDel(id);
    setConfirmDel(null);
    try {
      await api(`/api/keys/${id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAccount(null);
    setKeys([]);
    setNeedsLogin(true);
  }

  const base = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "/api/v1";
  const opencode = (token: string) => `// ~/.config/opencode/opencode.jsonc   then: export ${brand.repo.toUpperCase()}_API_KEY=${token}
{
  "$schema": "https://opencode.ai/config.json",
  "model": "${brand.repo}/${PRIVACY_MODES.anonymous.chatModel}",
  "providers": {
    "${brand.repo}": {
      "name": "${brand.name}",
      "env": ["${brand.repo.toUpperCase()}_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "${base}" },
      "models": { "large-v2": {}, "large-flash": {}, "deepseek-1017-uncensored": {} }
    }
  }
}`;

  return (
    <dialog ref={ref} className={`${s.dialog} ${k.wide}`} onClose={onClose} onCancel={onClose}>
      <div className={s.head}>
        <h2 className={s.title}>API keys</h2>
        <button className={s.x} onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className={s.p}>
        Use your credit from opencode, Cursor, SillyTavern or any OpenAI-compatible tool. Base URL <code className={k.inline}>{base}</code>
      </p>

      {!w.source ? (
        <p className={s.fine}>Connect a wallet first.</p>
      ) : needsLogin ? (
        <>
          <p className={s.p}>Sign a message with your wallet to manage keys. It&apos;s not a transaction and costs nothing.</p>
          <button className={s.primary} onClick={signIn} disabled={busy}>
            {busy ? "Check your wallet…" : "Sign in with your wallet"}
          </button>
        </>
      ) : !account ? (
        <p className={s.fine}>Loading…</p>
      ) : (
        <>
          <div className={k.wallet}>
            <div>
              <div className={s.label}>API wallet credit</div>
              <div className={k.big}>{usd(account.creditUsd, 4)}</div>
              {!!account.idleUsdc && account.idleUsdc > 0 && <div className={s.fine}>+ {account.idleUsdc.toFixed(2)} USDC waiting to be credited</div>}
            </div>
            <div className={k.walletActions}>
              <button className={s.secondary} onClick={() => w.openCredit({ kind: "api", address: account.apiWallet })}>
                Add credit
              </button>
              <button className={k.link} onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
          <p className={s.fine}>
            Your keys spend from a separate API wallet ({account.apiWallet.slice(0, 6)}…{account.apiWallet.slice(-4)}) that our server signs for. It only ever holds
            Venice credit, which can be spent on inference but never withdrawn. Requests pass through our server without being stored. For end-to-end
            encryption, use Truly private mode on this site.
          </p>

          {fresh && (
            <div className={k.fresh}>
              <div className={s.label}>New key “{fresh.name}”. Copy it now; it won&apos;t be shown again.</div>
              <code className={s.addr}>{fresh.token}</code>
              <button className={s.copyBtn} onClick={() => navigator.clipboard.writeText(fresh.token)}>
                Copy key
              </button>
              <div className={s.label}>opencode</div>
              <pre className={s.code}>{opencode(fresh.token)}</pre>
              <button className={s.copyBtn} onClick={() => navigator.clipboard.writeText(opencode(fresh.token))}>
                Copy config
              </button>
              <p className={s.fine}>Other tools: base URL {base}, API key above, model e.g. large-v2.</p>
            </div>
          )}

          <div className={k.listHead}>
            <div className={s.label}>Your keys</div>
            {!draft && (
              <button className={s.copyBtn} onClick={() => (setDraft({ ...EMPTY }), setEditing(null), setFresh(null))}>
                New key
              </button>
            )}
          </div>

          {draft && (
            <div className={k.form}>
              <input className={s.search} placeholder="Name (e.g. opencode laptop)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <div className={k.row}>
                <label className={k.field}>
                  Daily limit $
                  <input type="number" min="0" step="0.5" placeholder="none" value={draft.dailyUsd} onChange={(e) => setDraft({ ...draft, dailyUsd: e.target.value })} />
                </label>
                <label className={k.field}>
                  Total limit $
                  <input type="number" min="0" step="1" placeholder="none" value={draft.totalUsd} onChange={(e) => setDraft({ ...draft, totalUsd: e.target.value })} />
                </label>
                {!editing && (
                  <label className={k.field}>
                    Expires
                    <select value={draft.expiryDays} onChange={(e) => setDraft({ ...draft, expiryDays: e.target.value })}>
                      <option value="">never</option>
                      <option value="7">in 7 days</option>
                      <option value="30">in 30 days</option>
                      <option value="90">in 90 days</option>
                    </select>
                  </label>
                )}
              </div>
              <div className={s.label}>Allowed models (none selected = all)</div>
              <div className={k.models}>
                {Object.values(MODELS).map((m) => (
                  <label key={m.key} className={k.check}>
                    <input
                      type="checkbox"
                      checked={draft.models.includes(m.key)}
                      onChange={(e) =>
                        setDraft({ ...draft, models: e.target.checked ? [...draft.models, m.key] : draft.models.filter((x) => x !== m.key) })
                      }
                    />
                    {m.label.replace(" (TEE)", "")}
                    {m.e2ee && <span className={s.dim}> · TEE, no tools</span>}
                  </label>
                ))}
              </div>
              <div className={s.row}>
                <button className={s.secondary} onClick={() => (setDraft(null), setEditing(null))} disabled={busy}>
                  Cancel
                </button>
                <button className={s.primary} onClick={save} disabled={busy}>
                  {busy ? "Saving…" : editing ? "Save changes" : "Create key"}
                </button>
              </div>
            </div>
          )}

          {keys.length === 0 && !draft ? (
            <p className={s.fine}>No keys yet.</p>
          ) : (
            <ul className={k.list}>
              {keys.map((key) => (
                <li key={key.id} className={k.item}>
                  <div className={k.itemHead}>
                    <strong>{key.name}</strong>
                    <code className={k.inline}>{key.prefix}…</code>
                  </div>
                  <div className={k.meta}>
                    <span>
                      today {usd(key.spentTodayUsd, 4)}
                      {key.limits.dailyUsd ? ` / ${usd(key.limits.dailyUsd)}` : ""}
                    </span>
                    <span>
                      total {usd(key.spentTotalUsd, 4)}
                      {key.limits.totalUsd ? ` / ${usd(key.limits.totalUsd)}` : ""}
                    </span>
                    <span>{key.models.length ? `${key.models.length} model${key.models.length > 1 ? "s" : ""}` : "all models"}</span>
                    <span>used {ago(key.lastUsedAt)}</span>
                    {key.expiresAt && <span>{key.expiresAt < Date.now() ? "expired" : `expires ${new Date(key.expiresAt).toLocaleDateString()}`}</span>}
                  </div>
                  <div className={k.actions}>
                    <button
                      className={k.link}
                      onClick={() => {
                        setEditing(key.id);
                        setFresh(null);
                        setDraft({ name: key.name, dailyUsd: key.limits.dailyUsd?.toString() ?? "", totalUsd: key.limits.totalUsd?.toString() ?? "", models: key.models, expiryDays: "" });
                      }}
                    >
                      Edit
                    </button>
                    <button className={`${k.link} ${confirmDel === key.id ? k.danger : ""}`} onClick={() => remove(key.id)}>
                      {confirmDel === key.id ? "Click again to delete" : "Delete"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {err && <p className={s.warn}>{err}</p>}
    </dialog>
  );
}
