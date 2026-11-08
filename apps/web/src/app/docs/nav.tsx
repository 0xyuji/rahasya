"use client";

import { usePathname } from "next/navigation";
import s from "./docs.module.css";

export function DocsNav({ pages }: { pages: Array<{ href: string; title: string }> }) {
  const path = usePathname();
  return (
    <nav className={s.nav} aria-label="Docs">
      <div className={s.navTitle}>Docs</div>
      {pages.map((p) => (
        <a key={p.href} href={p.href} className={`${s.navLink} ${path === p.href ? s.navOn : ""}`} aria-current={path === p.href ? "page" : undefined}>
          {p.title}
        </a>
      ))}
    </nav>
  );
}
