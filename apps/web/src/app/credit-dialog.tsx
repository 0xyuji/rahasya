"use client";

import { CHAIN_LABEL, type Chain, type SymbolName } from "@pay/rail/browser";
import { useEffect, useRef, useState } from "react";
import {
  CREDIT_FINAL,
  MAX_CREDIT_USD,
  MIN_CREDIT_USD,
  PAY_OPTIONS,
  actions,
  dismiss,
  friendly,
  quoteCredit,
  recoverResend,
  resend,
  runCredit,
  type CreditAction,
} from "../funding/flow";
import { creditSteps } from "../funding/machines";
import { useCreditTarget } from "../funding/target";
import { useWallet } from "../wallet/wallet-context";
import { AnywherePanel } from "./anywhere-panel";
import s from "./credit-dialog.module.css";
import { UsdcPanel } from "./usdc-panel";

const PRESETS = [5, 10, 20];
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const explorer = (chain: Chain, tx: string) => (chain === "sol" ? `https://solscan.io/tx/${tx}` : `https://basescan.org/tx/${tx}`);

function steps(a: CreditAction) {
  const status = creditSteps(a);
  return [
    { label: `Send ${a.quote.quote.amountInFormatted} ${a.origin.symbol} from your wallet`, status: status[0] },
    { label: "Swap to USDC on Base through NEAR Intents (about 1–2 min)", status: status[1] },
    { label: `Add $${a.usd.toFixed(2)} of credit (signed in your browser)`, status: status[2] },
  ];
}

export function CreditDialog({ open, onClose, onCredited }: { open: boolean; onClose: () => void; onCredited: () => void }) {
  const w = useWallet();
  const t = useCreditTarget();
  const ref = useRef<HTMLDialogElement>(null);
  const options = w.source ? PAY_OPTIONS[w.source.chain] : [];
  const [usd, setUsd] = useState(5);
  const [pay, setPay] = useState(0);
  const [action, setAction] = useState<CreditAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"wallet" | "anywhere" | "usdc">("wallet");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // NEAR wallets can't use "From your wallet" yet, so don't open on a dead end.
  useEffect(() => {
    if (open && w.source?.chain === "near") setTab("anywhere");
  }, [open, w.source?.chain]);

  // Only ever show an action for the wallet this dialog is funding right now.
  const targetAddress = useRef(t.address);
  useEffect(() => {
    targetAddress.current = t.address;
    if (t.address) setAction((c) => (c && c.inferenceAddress !== t.address ? null : c));
  }, [t.address]);

  // Resume an unfinished deposit for this wallet instead of starting a new one.
  useEffect(() => {
    if (!open || !w.source || !t.address) return;
    const pending = actions
      .all()
      .filter((a) => a.source.address === w.source!.address && a.inferenceAddress === t.address && !CREDIT_FINAL.has(a.state) && (a.state !== "QUOTED" || a.resent))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (pending) {
      setAction(recoverResend(pending));
      void drive(pending.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, w.source?.address, t.address]);

  async function getQuote() {
    if (!w.source || !t.address) return;
    setBusy(true);
    setErr(null);
    try {
      setAction(await quoteCredit({ usd, payWith: options[pay]!, source: w.source, inferenceAddress: t.address }));
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function drive(id: string, unconfirmedWatchMs?: number) {
    if (!w.sender || (!w.inference && !t.topUp)) return;
    const saved = actions.get(id);
    if (saved?.inferenceAddress !== t.address || saved.source.address !== w.source?.address) return; // made for another wallet
    const show = (a: CreditAction) => {
      if (a.inferenceAddress === targetAddress.current) setAction(a);
    };
    setBusy(true);
    setErr(null);
    try {
      const done = await runCredit(id, { send: w.sender, inference: w.inference, onUpdate: show, topUp: t.topUp, unconfirmedWatchMs });
      show(done);
      if (done.error && !CREDIT_FINAL.has(done.state)) setErr(done.error);
      if (done.state === "DONE") onCredited();
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (action && CREDIT_FINAL.has(action.state)) setAction(null);
    onClose();
  };

  const q = action?.quote.quote;
  const feeUsd = q ? Number(q.amountInUsd) - (action?.usd ?? 0) : 0;

  return (
    <dialog ref={ref} className={s.dialog} onClose={close} onCancel={close} data-credit-state={action?.state ?? "NEW"}>
      <div className={s.head}>
        <h2 className={s.title}>{t.kind === "api" ? "Add credit to API wallet" : "Add credit"}</h2>
        <button className={s.x} onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      <div className={s.tabs} role="tablist" aria-label="How to pay">
        {([
          ["wallet", "From your wallet"],
          ["anywhere", "Any token, anywhere"],
          ["usdc", "USDC on Base"],
        ] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabOn : ""}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "anywhere" ? (
        <AnywherePanel onCredited={onCredited} />
      ) : tab === "usdc" ? (
        <UsdcPanel onCredited={onCredited} />
      ) : !w.source || !t.address ? (
        <p className={s.p}>Connect and unlock your wallet first.</p>
      ) : !w.sender ? (
        w.source.chain === "near" ? (
          <>
            <p className={s.p}>NEAR wallets pay through a deposit address: pick the amount, then send from your wallet.</p>
            <button className={s.primary} onClick={() => setTab("anywhere")}>
              Pay with NEAR
            </button>
          </>
        ) : (
          <p className={s.p}>Your wallet isn&apos;t ready to send yet. Reconnect and try again.</p>
        )
      ) : !action || action.state === "EXPIRED" ? (
        <>
          <p className={s.p}>Credit is prepaid and spent per message. It lives on your own inference wallet, not with us.</p>
          <div className={s.label}>Amount</div>
          <div className={s.presets}>
            {PRESETS.map((v) => (
              <button key={v} className={`${s.preset} ${usd === v ? s.on : ""}`} onClick={() => setUsd(v)}>
                ${v}
              </button>
            ))}
            <label className={s.custom}>
              $
              <input
                type="number"
                min={MIN_CREDIT_USD}
                max={MAX_CREDIT_USD}
                step={1}
                value={usd}
                onChange={(e) => setUsd(Number(e.target.value))}
                aria-label="Custom amount in USD"
              />
            </label>
          </div>
          <div className={s.label}>Pay with</div>
          <div className={s.presets}>
            {options.map((o, i) => (
              <button key={`${o.chain}:${o.symbol}`} className={`${s.preset} ${pay === i ? s.on : ""}`} onClick={() => setPay(i)}>
                {o.symbol} <span className={s.dim}>on {CHAIN_LABEL[o.chain]}</span>
              </button>
            ))}
          </div>
          {action?.state === "EXPIRED" && <p className={s.warn}>That quote expired before it was sent. Nothing moved; get a new one.</p>}
          <button className={s.primary} disabled={busy || usd < MIN_CREDIT_USD || usd > MAX_CREDIT_USD} onClick={getQuote}>
            {busy ? "Getting a quote…" : "Get quote"}
          </button>
          <p className={s.fine}>
            Minimum ${MIN_CREDIT_USD} (Venice's minimum top-up), maximum ${MAX_CREDIT_USD}.
          </p>
        </>
      ) : action.state === "QUOTED" ? (
        <>
          <dl className={s.quote}>
            <dt>You send</dt>
            <dd>
              {q!.amountInFormatted} {action.origin.symbol} <span className={s.dim}>≈ ${Number(q!.amountInUsd).toFixed(2)}</span>
            </dd>
            <dt>You get</dt>
            <dd>${action.usd.toFixed(2)} of credit</dd>
            <dt>Swap cost</dt>
            <dd>
              ≈ ${Math.max(0, feeUsd).toFixed(2)} <span className={s.dim}>(rate, solver and network fees, small buffer)</span>
            </dd>
            <dt>From</dt>
            <dd>
              {short(action.source.address)} <span className={s.dim}>· refunds go back here</span>
            </dd>
            <dt>To</dt>
            <dd>
              {t.label} {short(action.inferenceAddress)} <span className={s.dim}>on Base</span>
            </dd>
          </dl>
          <p className={s.fine}>
            Non-custodial: funds go from your wallet to your own inference wallet through NEAR Intents. We never hold them and can't reverse, freeze or recover
            anything. You're responsible for where your funds come from.
          </p>
          <div className={s.row}>
            <button className={s.secondary} onClick={() => setAction(null)} disabled={busy}>
              Back
            </button>
            <button className={s.primary} onClick={() => drive(action.id)} disabled={busy}>
              {busy ? "Confirm in your wallet…" : "Confirm and send"}
            </button>
          </div>
        </>
      ) : (
        <>
          <ol className={s.steps}>
            {steps(action).map((st) => (
              <li key={st.label} className={s[st.status]}>
                <span className={s.mark} aria-hidden />
                {st.label}
              </li>
            ))}
          </ol>
          {action.oneclickStatus && !CREDIT_FINAL.has(action.state) && <p className={s.fine}>1Click status: {action.oneclickStatus.replaceAll("_", " ").toLowerCase()}</p>}
          {action.depositTx && (
            <p className={s.fine}>
              Deposit:{" "}
              <a href={explorer(action.origin.chain, action.depositTx)} target="_blank" rel="noreferrer">
                {short(action.depositTx)}
              </a>
              {action.deliveredTx && (
                <>
                  {" "}
                  · Delivered:{" "}
                  <a href={explorer("base", action.deliveredTx)} target="_blank" rel="noreferrer">
                    {short(action.deliveredTx)}
                  </a>
                </>
              )}
            </p>
          )}
          {action.state === "DONE" && <p className={s.ok}>Added ${action.usd.toFixed(2)} of credit.</p>}
          {action.state === "REFUNDED" && <p className={s.warn}>The swap couldn't complete, so {action.refunded ?? "your deposit"} was refunded to your wallet.</p>}
          {action.state === "FAILED" && <p className={s.warn}>{action.error}</p>}
          {(action.state === "DEPOSIT_SENT" || action.state === "SWAPPING") && action.error && !busy && (
            <div className={s.row}>
              <button className={s.secondary} onClick={() => (dismiss(action.id), setAction(null))}>
                Stop tracking
              </button>
              <button className={s.primary} onClick={() => drive(action.id)}>
                Keep waiting
              </button>
            </div>
          )}
          {action.state === "SEND_UNCONFIRMED" && (
            <>
              <p className={s.warn}>
                {action.depositTx
                  ? "Your wallet sent a transaction, but 1Click hasn't seen the deposit yet. Check the link above. If it went through, keep waiting."
                  : "We never got a transaction back from your wallet, and 1Click hasn't seen a deposit yet. If your wallet shows it as sent, keep waiting."}{" "}
                If it didn&apos;t, send again. An extra deposit is normally refunded, minus a refund fee.
              </p>
              <div className={s.row}>
                <button className={s.secondary} onClick={() => drive(action.id, 60_000)} disabled={busy}>
                  {busy ? "Looking for your deposit…" : "Keep waiting"}
                </button>
                <button className={s.primary} onClick={() => (setAction(resend(action.id)), void drive(action.id))} disabled={busy}>
                  Send again
                </button>
              </div>
              <button className={s.secondary} onClick={() => (dismiss(action.id), setAction(null))} disabled={busy}>
                Stop tracking this deposit
              </button>
              <p className={s.fine}>Stopping sends nothing. If a deposit does arrive, the USDC shows up on the USDC on Base tab.</p>
            </>
          )}
          {action.state === "TOPPING_UP" && action.error && !busy && (
            <div className={s.row}>
              <button className={s.secondary} onClick={() => (dismiss(action.id), setAction(null))}>
                Stop, keep it as USDC
              </button>
              <button className={s.primary} onClick={() => drive(action.id)}>
                Retry adding credit
              </button>
            </div>
          )}
          {CREDIT_FINAL.has(action.state) && (
            <button className={s.primary} onClick={close}>
              Done
            </button>
          )}
        </>
      )}
      {tab === "wallet" && err && <p className={s.warn}>{err}</p>}
    </dialog>
  );
}
