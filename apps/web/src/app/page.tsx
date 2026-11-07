import { Prompt } from "./prompt";
import s from "./page.module.css";
import { brand } from "../brand";


export default function Home() {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <header className={s.top}>
        <a href="/" className={s.lockup} aria-label={`${brand.name} — ${brand.tagline}`}>
          <span className={s.wordmark}>{brand.name}</span>
          <span className={s.tagline}>{brand.tagline}</span>
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
          <p className={s.sub}>Uncensored models, paid with whatever token you hold. No account. No card.</p>
          <Prompt />
        </div>
      </main>

      <footer className={s.foot}>Non-custodial. Your wallet, your keys, your credit.</footer>
    </>
  );
}
