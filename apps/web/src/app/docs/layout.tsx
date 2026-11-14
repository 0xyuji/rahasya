import type { Metadata } from "next";
import { brand } from "../../brand";
import { Mascot } from "../mascot";
import page from "../page.module.css";
import { PAGES } from "./content";
import { DocsNav } from "./nav";
import s from "./docs.module.css";

export const metadata: Metadata = {
  title: `Docs · ${brand.name}`,
  description: `How to use ${brand.name}: chat, API keys for opencode/Cursor/SillyTavern, the OpenAI-compatible API, and how payments and privacy work.`,
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="backdrop" aria-hidden />
      <header className={page.top}>
        <a href="/" className={page.lockup} aria-label={`${brand.name}: ${brand.tagline}`}>
          <Mascot className={page.mark} wakeOnHover />
          <span className={page.wordmark}>{brand.name}</span>
        </a>
        <a href="/" className={s.openApp}>
          Open chat
        </a>
      </header>
      <div className={s.shell}>
        <DocsNav pages={PAGES.map((p) => ({ href: p.slug ? `/docs/${p.slug}` : "/docs", title: p.title }))} />
        <main className={s.main}>{children}</main>
      </div>
    </>
  );
}
