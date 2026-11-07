"use client";

import { useEffect, useRef, useState } from "react";
import { useCredit } from "../wallet/use-credit";
import { useWallet } from "../wallet/wallet-context";
import { CreditDialog } from "./credit-dialog";
import { EditorDialog } from "./editor-dialog";
import s from "./connect-button.module.css";

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const CHAIN: Record<string, string> = { evm: "Base", sol: "Solana", near: "NEAR" };

export function ConnectButton() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const { creditUsd, idleUsdc, refresh } = useCredit();
  const [editor, setEditor] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  let label: string;
  if (!w.source) label = "Connect wallet";
  else if (!w.inference) label = w.busy ? "Check your wallet…" : "Unlock";
  else label = creditUsd === null ? short(w.source.address) : `$${creditUsd.toFixed(2)} · ${short(w.source.address)}`;

  const onMain = () => {
    if (w.source && !w.inference && !w.busy) return void w.unlock();
    setOpen((o) => !o);
  };

  return (
    <div className={s.root} ref={root}>
      <button type="button" className={s.button} onClick={onMain} aria-haspopup="menu" aria-expanded={open} disabled={w.busy}>
        {w.source && <span className={`${s.dot} ${w.inference ? s.dotOn : ""}`} aria-hidden />}
        {label}
      </button>

      {open && (
        <div className={s.menu} role="menu">
          {!w.source ? (
            <>
              <p className={s.hint}>Your wallet is your login. It also funds your credit.</p>
              <button role="menuitem" className={s.item} onClick={() => (setOpen(false), w.connectEvmOrSolana())}>
                <span>EVM or Solana wallet</span>
                <span className={s.sub}>MetaMask, Rabby, Phantom, Solflare…</span>
              </button>
              <button role="menuitem" className={s.item} onClick={() => (setOpen(false), void w.connectNear())}>
                <span>NEAR wallet</span>
                <span className={s.sub}>HOT, Meteor, MyNearWallet, Intear…</span>
              </button>
            </>
          ) : (
            <>
              <div className={s.row}>
                <span className={s.k}>Wallet</span>
                <span className={s.v}>
                  {short(w.source.address)} · {CHAIN[w.source.chain]}
                </span>
              </div>
              {w.inference && (
                <div className={s.row}>
                  <span className={s.k}>Inference wallet</span>
                  <button className={s.copy} onClick={() => navigator.clipboard.writeText(w.inference!.address)} title="Copy address">
                    {short(w.inference.address)} · Base
                  </button>
                </div>
              )}
              {w.inference && (
                <div className={s.row}>
                  <span className={s.k}>Credit</span>
                  <span className={s.v}>
                    {creditUsd === null ? "…" : `$${creditUsd.toFixed(4)}`}
                    {idleUsdc ? ` + ${idleUsdc.toFixed(2)} USDC idle` : ""}
                  </span>
                </div>
              )}
              {w.inference && (
                <button role="menuitem" className={s.item} onClick={() => (setOpen(false), w.setCreditOpen(true))}>
                  <span>Add credit</span>
                  <span className={s.sub}>Pay with any token from your wallet</span>
                </button>
              )}
              {w.inference && (
                <button role="menuitem" className={s.item} onClick={() => (setOpen(false), setEditor(true))}>
                  <span>Use in your editor</span>
                  <span className={s.sub}>opencode, Cursor, SillyTavern, any OpenAI-compatible tool</span>
                </button>
              )}
              <p className={s.hint}>
                The inference wallet is recreated from your signature each time you unlock. It is never stored or sent anywhere.
              </p>
              {w.inference ? (
                <button role="menuitem" className={s.item} onClick={() => (setOpen(false), w.lock())}>
                  Lock
                </button>
              ) : (
                <button role="menuitem" className={s.item} onClick={() => (setOpen(false), void w.unlock())}>
                  Unlock
                </button>
              )}
              <button role="menuitem" className={s.item} onClick={() => (setOpen(false), void w.disconnect())}>
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
      {w.error && <p className={s.error}>{w.error}</p>}
      <EditorDialog open={editor} onClose={() => setEditor(false)} />
      <CreditDialog open={w.creditOpen} onClose={() => w.setCreditOpen(false)} onCredited={refresh} />
    </div>
  );
}
