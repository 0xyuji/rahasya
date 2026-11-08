"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { creditIdleUsdc } from "../funding/anywhere";
import { MIN_CREDIT_USD, friendly, inferenceUsdc } from "../funding/flow";
import { sweepApiWallet, useCreditTarget } from "../funding/target";
import { useWallet } from "../wallet/wallet-context";
import s from "./credit-dialog.module.css";

export function UsdcPanel({ onCredited }: { onCredited: () => void }) {
  const w = useWallet();
  const t = useCreditTarget();
  const [qr, setQr] = useState("");
  const [idle, setIdle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (t.address) setIdle(Number(await inferenceUsdc(t.address).catch(() => 0n)) / 1e6);
  }, [t.address]);

  useEffect(() => {
    if (!t.address) return;
    QRCode.toString(t.address, { type: "svg", margin: 1, color: { dark: "#0c0d0f", light: "#ece7de" } }).then(setQr, () => {});
    void refresh();
  }, [t.address, refresh]);

  if (!t.address) return <p className={s.p}>Unlock your wallet first.</p>;

  async function sweep() {
    setBusy(true);
    setMsg(null);
    try {
      const usd = t.kind === "api" ? await sweepApiWallet() : await creditIdleUsdc(w.inference!);
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
      <p className={s.p}>Already have USDC on Base? Send it straight to {t.label}. No swap, no swap fee.</p>
      <div className={s.deposit}>
        {qr && <div className={s.qr} dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code of the receiving address" />}
        <div className={s.depositInfo}>
          <div className={s.label}>{t.kind === "api" ? "Your API wallet (Base)" : "Your inference wallet (Base)"}</div>
          <code className={s.addr}>{t.address}</code>
          <button type="button" className={s.copyBtn} onClick={() => navigator.clipboard.writeText(t.address!)}>
            Copy
          </button>
        </div>
      </div>
      <p className={s.fine}>Only send USDC on Base here. Other tokens or networks can be lost.</p>
      <dl className={s.quote}>
        <dt>Idle USDC</dt>
        <dd>{idle === null ? "…" : `${idle.toFixed(2)} USDC`}</dd>
      </dl>
      <button className={s.primary} disabled={busy || idle === null || idle < MIN_CREDIT_USD} onClick={sweep}>
        {busy ? "Adding credit…" : idle !== null && idle >= MIN_CREDIT_USD ? `Turn $${(Math.floor(idle * 100) / 100).toFixed(2)} into credit` : `Needs at least $${MIN_CREDIT_USD} of USDC`}
      </button>
      {msg && <p className={msg.ok ? s.ok : s.warn}>{msg.text}</p>}
    </>
  );
}
