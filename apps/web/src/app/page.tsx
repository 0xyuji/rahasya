import { Prompt } from "./prompt";
import s from "./page.module.css";

const NAME = "Sotto";
const TAGLINE = "Private AI, paid in any token";

export default function Home() {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <header className={s.top}>
        <a href="/" className={s.lockup} aria-label={`${NAME} — ${TAGLINE}`}>
          <span className={s.wordmark}>{NAME}</span>
          <span className={s.tagline}>{TAGLINE}</span>
        </a>
        <button className={s.connect} type="button">
          Connect wallet
        </button>
      </header>

      <main className={s.main}>
        <div className={s.center}>
          <h1 className={s.headline}>
            Speak <em>freely.</em>
          </h1>
          <p className={s.sub}>Uncensored models, paid with whatever token you hold. No account, no card, no logs.</p>
          <Prompt />
        </div>
      </main>

      <footer className={s.foot}>Non-custodial. Your wallet, your keys, your credit.</footer>
    </>
  );
}
