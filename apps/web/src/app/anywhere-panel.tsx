"use client";

import type { TokenResponse } from "@pay/rail/browser";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANYWHERE_FINAL,
  anywhereActions,
  anywhereDeadline,
  cancelAnywhere,
  chainName,
  dismissAnywhere,
  isEvmChain,
  quoteAnywhere,
  recheckClosed,
  refundAddressProblem,
  runAnywhere,
  sendableTokens,
  type AnywhereAction,
} from "../funding/anywhere";
import { MAX_CREDIT_USD, MIN_CREDIT_USD, friendly, oneclick } from "../funding/flow";
import { anywhereSteps } from "../funding/machines";
import { useCreditTarget } from "../funding/target";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";
import { CopyButton } from "./dialog-parts";

const PRESETS = [5, 10, 20];
const fmtUnits = (u: string, d: number) => (Number(u) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: Math.min(d, 8) });

function useCountdown(deadline?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return "";
  const ms = Math.max(0, Date.parse(deadline) - now);
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function AnywherePanel({ onCredited }: { onCredited: () => void }) {
  const w = useWallet();
  const t = useCreditTarget();
  const [tokens, setTokens] = useState<TokenResponse[]>([]);
  const [query, setQuery] = useState("");
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [usd, setUsd] = useState(10);
  const [refundTo, setRefundTo] = useState("");
  const [action, setAction] = useState<AnywhereAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [retries, setRetries] = useState(0);
  const countdown = useCountdown(action ? new Date(anywhereDeadline(action)).toISOString() : undefined);

  useEffect(() => {
    oneclick.tokens().then((t) => setTokens(sendableTokens(t)), (e) => setErr(friendly(e)));
  }, []);

  // Resume the newest unfinished deposit for this inference wallet.
  useEffect(() => {
    if (!t.address) return;
    const pending = anywhereActions
      .all()
      .filter((a) => a.inferenceAddress === t.address && !ANYWHERE_FINAL.has(a.state) && !(a.state === "INCOMPLETE" && Date.now() > anywhereDeadline(a)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    setAction(pending ?? null); // never keep showing an action for a different wallet
    let current = true;
    const address = t.address;
    void recheckClosed(address).then((late) => {
      if (current && late?.inferenceAddress === address) setAction((c) => c ?? late);
    }, () => {});
    return () => {
      current = false;
    };
  }, [t.address]);

  // A connected NEAR wallet starts with NEAR selected (once, so "change" still works).
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || w.source?.chain !== "near" || !tokens.length) return;
    preselected.current = true;
    setToken((c) => c ?? tokens.find((x) => x.blockchain === "near" && x.symbol === "wNEAR") ?? null);
  }, [tokens, w.source?.chain]);

  // Watch the deposit while this panel is open.
  useEffect(() => {
    if (!action || ANYWHERE_FINAL.has(action.state) || action.inferenceAddress !== t.address) return; // only ever for the wallet being funded
    const ctl = new AbortController();
    const onUpdate = (a: AnywhereAction) => {
      if (!ctl.signal.aborted) setAction(a);
    };
    const id = action.id;
    void runAnywhere(id, { inference: w.inference, onUpdate, signal: ctl.signal, topUp: t.topUp }).then(
      (a) => {
        if (a.state === "DONE") onCredited();
      },
      () => {
        // Usually another tab moved it on: show what's saved.
        const saved = anywhereActions.get(id);
        if (saved && !ctl.signal.aborted) setAction(saved);
      },
    );
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id, w.inference, retries]);

  useEffect(() => {
    const addr = action?.quote.quote.depositAddress;
    if (addr) QRCode.toString(addr, { type: "svg", margin: 1, color: { dark: "#0c0d0f", light: "#ece7de" } }).then(setQr, () => setQr(""));
  }, [action?.quote.quote.depositAddress]);

  // Prefill the refund address when the chosen chain matches the connected wallet.
  useEffect(() => {
    if (!token || !w.source) return;
    const evm = /^0x[0-9a-fA-F]{40}$/.test(w.source.address);
    if ((w.source.chain === "sol" && token.blockchain === "sol") || (w.source.chain === "near" && token.blockchain === "near")) setRefundTo(w.source.address);
    else if (evm && isEvmChain(token.blockchain)) setRefundTo(w.source.address);
    else setRefundTo("");
  }, [token, w.source]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = q ? tokens.filter((t) => t.symbol.toLowerCase().includes(q) || chainName(t.blockchain).toLowerCase().includes(q)) : tokens;
    return l.slice(0, 60);
  }, [tokens, query]);

  async function getQuote() {
    if (!token || !t.address) return;
    setBusy(true);
    setErr(null);
    try {
      setAction(await quoteAnywhere({ usd, token, refundTo, inferenceAddress: t.address }));
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  if (!t.address) return <p className={s.p}>Unlock your wallet first, so we know where to deliver.</p>;

  // ---------- deposit screen ----------
  if (action) {
    const q = action.quote.quote;
    const t = action.token;
    const live = !ANYWHERE_FINAL.has(action.state);
    const progress = anywhereSteps(action.state);
    return (
      <div data-anywhere-state={action.state} style={{ display: "contents" }}>
        {action.state === "AWAITING_DEPOSIT" || action.state === "INCOMPLETE" ? (
          <>
            <p className={s.p}>
              Send <strong>{t.symbol}</strong> on <strong>{chainName(t.blockchain)}</strong> from any wallet or exchange to this address.
            </p>
            <div className={s.deposit}>
              {qr && <div className={s.qr} dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code of the deposit address" />}
              <div className={s.depositInfo}>
                <div className={s.label}>Deposit address</div>
                <code className={s.addr}>{q.depositAddress}</code>
                <CopyButton text={q.depositAddress!} />
                {q.depositMemo && (
                  <>
                    <div className={s.label}>Memo (required)</div>
                    <code className={s.addr}>{q.depositMemo}</code>
                    <CopyButton text={q.depositMemo} />
                  </>
                )}
              </div>
            </div>
            <dl className={s.quote}>
              <dt>Send</dt>
              <dd>
                {fmtUnits(q.amountIn, t.decimals)} {t.symbol} <span className={s.dim}>≈ ${Number(q.amountInUsd).toFixed(2)}</span>
              </dd>
              <dt>At least</dt>
              <dd>
                {fmtUnits(q.minAmountIn, t.decimals)} {t.symbol} <span className={s.dim}>after any exchange fee</span>
              </dd>
              <dt>You get</dt>
              <dd>
                about ${Number(q.amountOutUsd).toFixed(2)} of credit <span className={s.dim}>(what actually arrives)</span>
              </dd>
              <dt>Refunds</dt>
              <dd className={s.break}>{action.refundTo}</dd>
              <dt>Send within</dt>
              <dd>{countdown}</dd>
            </dl>
            {t.blockchain === "zec" && (
              <p className={s.fine}>
                Zcash: this is a transparent (t1…) address, so the amount is visible on-chain, but not who sent it from a shielded wallet. Send from spendable
                (confirmed) funds and leave room for the network fee; anything between the two amounts above works. If your wallet won&apos;t send to a transparent
                address, allow it in its privacy settings or shield your funds first. Arrival takes about 8–10 minutes.
                <br />
                Sending from the Ironwood pool needs an Ironwood-ready wallet (NU6.3). If your wallet errors (for example &quot;No feasible note selection
                found&quot;), update it first; Zodl, Cake Wallet, Vizor, Zkool and Zingo support Ironwood. Ywallet does not.
              </p>
            )}
            {action.state === "INCOMPLETE" && (
              <p className={s.warn}>
                {Date.now() > anywhereDeadline(action)
                  ? "Less than the minimum arrived and this deposit has expired, so it will be refunded to your refund address."
                  : "Less than the minimum has arrived so far. Send the rest before the timer ends, or it's refunded to your refund address."}
              </p>
            )}
            <p className={s.fine}>
              Only send {t.symbol} on {chainName(t.blockchain)}. Other tokens or networks sent here can be lost. Waiting for your deposit; you can close this and come back.
            </p>
          </>
        ) : progress ? (
          <ol className={s.steps}>
            {[`${t.symbol} deposit received`, "Swap to USDC on Base through NEAR Intents", "Add credit"].map((label, i) => (
              <li key={label} className={s[progress[i]!]}>
                <span className={s.mark} aria-hidden />
                {label}
              </li>
            ))}
          </ol>
        ) : null}
        {action.state === "DONE" && <p className={s.ok}>Added ${action.creditedUsd?.toFixed(2)} of credit.</p>}
        {action.state === "IDLE" && <p className={s.warn}>{action.error ?? "Your USDC arrived. Unlock to turn it into credit (USDC on Base tab)."}</p>}
        {action.state === "REFUNDED" && <p className={s.warn}>The swap couldn't complete; your deposit was refunded to {action.refundTo}.</p>}
        {action.state === "FAILED" && <p className={s.warn}>{action.error}</p>}
        {action.state === "EXPIRED" && <p className={s.warn}>This deposit address expired without a deposit. Nothing was received; get a new one.</p>}
        {action.state === "TOPPING_UP" && action.error && (
          <>
            <p className={s.warn}>{action.error}</p>
            <div className={s.row}>
              <button className={s.secondary} onClick={() => setAction(dismissAnywhere(action.id))}>
                Stop, keep it as USDC
              </button>
              <button className={s.primary} onClick={() => setRetries((n) => n + 1)}>
                Retry adding credit
              </button>
            </div>
          </>
        )}
        {live && action.oneclickStatus && <p className={s.fine}>1Click status: {action.oneclickStatus.replaceAll("_", " ").toLowerCase()}</p>}
        {!live && (
          <button className={s.primary} onClick={() => setAction(null)}>
            {action.state === "DONE" ? "Add more" : "Start over"}
          </button>
        )}
        {action.state === "INCOMPLETE" && Date.now() > anywhereDeadline(action) && (
          <button className={s.primary} onClick={() => setAction(null)}>
            Start over
          </button>
        )}
        {live && action.state === "AWAITING_DEPOSIT" && (
          <button className={s.secondary} onClick={() => (cancelAnywhere(action.id), setAction(null))}>
            Cancel and use a different token
          </button>
        )}
      </div>
    );
  }

  // ---------- choose token ----------
  return (
    <>
      <p className={s.p}>Pay with any of {tokens.length || "200+"} tokens on {new Set(tokens.map((t) => t.blockchain)).size || "35+"} chains, from any wallet or exchange.</p>
      <div className={s.label}>Token</div>
      {token ? (
        <button className={`${s.preset} ${s.on}`} onClick={() => setToken(null)}>
          {token.symbol} <span className={s.dim}>on {chainName(token.blockchain)} · change</span>
        </button>
      ) : (
        <>
          <input className={s.search} placeholder="Search BTC, ZEC, Arbitrum…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <ul className={s.tokens}>
            {list.map((t) => (
              <li key={t.assetId}>
                <button onClick={() => setToken(t)}>
                  <span>{t.symbol}</span>
                  <span className={s.dim}>{chainName(t.blockchain)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {token && (
        <>
          <div className={s.label}>Amount</div>
          <div className={s.presets}>
            {PRESETS.map((v) => (
              <button key={v} className={`${s.preset} ${usd === v ? s.on : ""}`} onClick={() => setUsd(v)}>
                ${v}
              </button>
            ))}
            <label className={s.custom}>
              $
              <input type="number" min={MIN_CREDIT_USD} max={MAX_CREDIT_USD} value={usd} onChange={(e) => setUsd(Number(e.target.value))} aria-label="Amount in USD" />
            </label>
          </div>
          <div className={s.label}>Refund address on {chainName(token.blockchain)}</div>
          <input className={s.search} placeholder="Where refunds go if the swap can't complete" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} />
          <p className={s.fine}>Use an address you control. Don't use an exchange deposit address; refunds there can be lost.</p>
          <button className={s.primary} disabled={busy || !refundTo.trim()} onClick={getQuote}>
            {busy ? "Getting a deposit address…" : "Get deposit address"}
          </button>
        </>
      )}
      {err && <p className={s.warn}>{err}</p>}
    </>
  );
}
