"use client";

import { useWallet } from "../wallet/wallet-context";
import s from "./page.module.css";

/** Header links to the two ways of using credit outside this page. They open before you connect. */
export function NavTools() {
  const w = useWallet();
  return (
    <>
      <button type="button" className={`${s.docsLink} ${s.navBtn} ${s.navTool}`} onClick={() => w.setToolPanel("keys")}>
        API
      </button>
      <button type="button" className={`${s.docsLink} ${s.navBtn} ${s.navTool}`} onClick={() => w.setToolPanel("proxy")}>
        Local proxy
      </button>
    </>
  );
}

/** Under the prompt on the empty page: the three ways to use it, in one quiet line. */
export function WaysRow() {
  const w = useWallet();
  return (
    <p className={s.ways}>
      <span>Chat here</span>
      <span className={s.waysDot} aria-hidden>
        ·
      </span>
      <button type="button" className={s.waysLink} onClick={() => w.setToolPanel("keys")}>
        API keys for your tools
      </button>
      <span className={s.waysDot} aria-hidden>
        ·
      </span>
      <button type="button" className={s.waysLink} onClick={() => w.setToolPanel("proxy")}>
        Local proxy <span className={s.waysNote}>(most private)</span>
      </button>
    </p>
  );
}
