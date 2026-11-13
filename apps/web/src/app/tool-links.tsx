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
