import { ChatApp } from "../chat/chat-app";
import s from "./page.module.css";
import { brand } from "../brand";
import { ConnectButton } from "./connect-button";
import { NavTools } from "./tool-links";
import { Mark } from "./mark";

export default function Home() {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <header className={s.top}>
        <a href="/" className={s.lockup} aria-label={`${brand.name} — ${brand.tagline}`}>
          <Mark className={s.mark} />
          <span className={s.wordmark}>{brand.name}</span>
          <span className={s.tagline}>{brand.tagline}</span>
        </a>
        <nav className={s.navRight}>
          <NavTools />
          <a href="/docs" className={s.docsLink}>
            Docs
          </a>
          <ConnectButton />
        </nav>
      </header>

      <ChatApp />

      <footer className={s.foot}>Website chat is non-custodial: your wallet, your keys, your credit.</footer>
    </>
  );
}
