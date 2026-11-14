"use client";

import type { ReactNode } from "react";
import { useWallet } from "../wallet/wallet-context";
import { brand } from "../brand";
import { GlyphArt, drawBubble, drawCoins, drawEnclave, drawKey, drawTerminal, type GlyphDraw } from "./glyph-art";
import { Mascot } from "./mascot";
import { MascotGlyph } from "./mascot-glyph";
import s from "./landing.module.css";

/** One feature: a glyph picture, a few words, and at most one line of actions. */
function Tile({ art, tone, title, line, size = "small", children }: { art: GlyphDraw; tone?: "paper" | "brass"; title: string; line: string; size?: "big" | "small"; children?: ReactNode }) {
  return (
    <article className={`${s.tile} ${size === "big" ? s.tileBig : ""}`}>
      <GlyphArt draw={art} tone={tone} className={s.art} />
      <div className={s.tileText}>
        <h3 className={s.h3}>{title}</h3>
        <p className={s.line}>{line}</p>
        {children && <div className={s.tileActions}>{children}</div>}
      </div>
    </article>
  );
}

function startChat() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  document.querySelector<HTMLTextAreaElement>("main textarea")?.focus({ preventScroll: true });
}

export function LandingSections() {
  const w = useWallet();
  return (
    <div className={s.page}>
      <div className={s.sheet}>
        <section className={s.inner} aria-labelledby="landing-why">
          <h2 id="landing-why" className={s.h2}>
            Private AI, <em>paid with anything.</em>
          </h2>

          <div className={s.bento}>
            <Tile size="big" art={drawCoins} title="Any token becomes credit" line="200+ tokens on 39 chains, swapped by NEAR Intents. Even ZEC from a shielded pool.">
              <span className={s.tag}>NEAR Intents</span>
              <span className={s.tag}>x402</span>
              <span className={s.tag}>$5 minimum</span>
            </Tile>
            <Tile art={drawEnclave} tone="brass" title="Provably private" line="Your browser checks the enclave before a word leaves.">
              <a className={s.textLink} href="/docs/protocol">
                How it&apos;s verified
              </a>
            </Tile>
            <Tile art={drawBubble} title="No lectures" line="Uncensored and abliterated models, served by Venice.">
              <button type="button" className={s.textLink} onClick={startChat}>
                Ask something
              </button>
            </Tile>
            <Tile art={drawKey} title="No account" line="One signature. Your wallet, your keys, your credit.">
              <a className={s.textLink} href="/docs">
                How it works
              </a>
            </Tile>
            <Tile art={drawTerminal} title="In your tools" line="An OpenAI-compatible API, or a proxy on your machine.">
              <button type="button" className={s.textLink} onClick={() => w.setToolPanel("keys")}>
                API key
              </button>
              <button type="button" className={s.textLink} onClick={() => w.setToolPanel("proxy")}>
                Local proxy
              </button>
            </Tile>
          </div>

          <p className={s.honest}>
            Not everything is private, and we say what isn&apos;t.{" "}
            <a className={s.textLink} href="/docs/protocol">
              Who sees what
            </a>
          </p>
        </section>
      </div>

      {/* The sheet ends here, so the cipher field and the figure come back behind the last line. */}
      <section className={s.closing} aria-label="Start">
        <MascotGlyph className={s.closingMascot} />
        <p className={s.closingLine}>
          No account. No card.
          <em>Just ask.</em>
        </p>
        <div className={s.actions}>
          <button type="button" className={s.primary} onClick={startChat}>
            Start a chat
          </button>
          <a className={s.textLink} href="/docs">
            Read the docs
          </a>
        </div>
      </section>

      <footer className={s.footer}>
        <div className={s.footInner}>
          <div className={s.footTop}>
            <span className={s.footLockup}>
              <Mascot className={s.footMark} wakeOnHover />
              <span>{brand.name}</span>
            </span>
            <nav className={s.footLinks} aria-label="Footer">
              <a href="/docs">Docs</a>
              <a href="/docs/protocol">Protocol</a>
              <a href="/docs/api">API</a>
              <a href="/agents.md">For AI agents</a>
              <a href={`https://github.com/0xyuji/${brand.repo}`} target="_blank" rel="noreferrer">
                GitHub
              </a>
            </nav>
          </div>
          <p className={s.footNote}>Website chat is non-custodial: your wallet, your keys, your credit. Built at NEAR HACKATHON. Open source, MIT.</p>
        </div>
      </footer>
    </div>
  );
}
