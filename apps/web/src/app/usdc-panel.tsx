"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { creditIdleUsdc } from "../funding/anywhere";
import { MIN_CREDIT_USD, friendly } from "../funding/flow";
import { useCredit } from "../wallet/use-credit";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";

export function UsdcPanel({ onCredited }: { onCredited: () => void }) {
  const w = useWallet();
  const { idleUsdc, refresh } = useCredit();
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (w.inference) QRCode.toString(w.inference.address, { type: "svg", margin: 1, color: { dark: "#0c0d0f", light: "#ece7de" } }).then(setQr, () => {});
  }, [w.inference]);

  if (!w.inference) return <p className={s.p}>Unlock your wallet first.</p>;

  async function sweep() {
    setBusy(true);
    setMsg(null);
    try {
      const usd = await creditIdleUsdc(w.inference!);
      setMsg({ ok: true, text: `Added $${usd.toFixed(2)} of credit.` });
      onCredited();
      void refresh();
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className={s.p}>Already have USDC on Base? Send it straight to your inference wallet. No swap, no swap fee.</p>
      <div className={s.deposit}>
        {qr && <div className={s.qr} dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code of your inference wallet address" />}
        <div className={s.depositInfo}>
          <div className={s.label}>Your inference wallet (Base)</div>
          <code className={s.addr}>{w.inference.address}</code>
          <button type="button" className={s.copyBtn} onClick={() => navigator.clipboard.writeText(w.inference!.address)}>
            Copy
          </button>
        </div>
      </div>
      <p className={s.fine}>Only send USDC on Base here. Other tokens or networks can be lost.</p>
      <dl className={s.quote}>
        <dt>Idle USDC</dt>
        <dd>{idleUsdc === null ? "…" : `${idleUsdc.toFixed(2)} USDC`}</dd>
      </dl>
      <button className={s.primary} disabled={busy || idleUsdc === null || idleUsdc < MIN_CREDIT_USD} onClick={sweep}>
        {busy ? "Adding credit…" : idleUsdc !== null && idleUsdc >= MIN_CREDIT_USD ? `Turn $${(Math.floor(idleUsdc * 100) / 100).toFixed(2)} into credit` : `Needs at least $${MIN_CREDIT_USD} of USDC`}
      </button>
      {msg && <p className={msg.ok ? s.ok : s.warn}>{msg.text}</p>}
    </>
  );
}
