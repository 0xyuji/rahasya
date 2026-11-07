import { ChatApp } from "../chat/chat-app";
import s from "./page.module.css";
import { brand } from "../brand";
import { ConnectButton } from "./connect-button";


export default function Home() {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <header className={s.top}>
        <a href="/" className={s.lockup} aria-label={`${brand.name} — ${brand.tagline}`}>
          <span className={s.wordmark}>{brand.name}</span>
          <span className={s.tagline}>{brand.tagline}</span>
        </a>
        <ConnectButton />
      </header>

      <ChatApp />

      <footer className={s.foot}>Non-custodial. Your wallet, your keys, your credit.</footer>
    </>
  );
}
