"use client";

import { Children, isValidElement, useEffect, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { brand } from "../../brand";
import s from "./docs.module.css";

/** Fill placeholders so readers copy working snippets: real origin + current brand. */
function personalize(md: string, origin: string): string {
  return md
    .replaceAll("https://<your-deployment>", origin)
    .replaceAll("https://<deployment>", origin)
    .replaceAll("RAHASYA_API_KEY", `${brand.repo.toUpperCase()}_API_KEY`)
    .replaceAll('"rahasya', `"${brand.repo}`)
    .replaceAll("rahasya/", `${brand.repo}/`)
    .replaceAll('"Rahasya"', `"${brand.name}"`);
}

const text = (n: ReactNode): string =>
  Children.toArray(n)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? text(c.props.children) : ""))
    .join("");

const slug = (n: ReactNode) =>
  text(n)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

function Heading({ level, children }: { level: 2 | 3; children: ReactNode }) {
  const id = slug(children);
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id}>
      <a href={`#${id}`} className={s.anchor} aria-hidden tabIndex={-1}>
        #
      </a>
      {children}
    </Tag>
  );
}

function Pre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.codeWrap}>
      <pre>{children}</pre>
      <button
        type="button"
        className={s.copy}
        onClick={() => {
          void navigator.clipboard.writeText(text(children).replace(/\n$/, ""));
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function DocBody({ md }: { md: string }) {
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_SITE_URL ?? "https://<your-deployment>");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <article className={s.body}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <Heading level={2}>{children}</Heading>,
          h3: ({ children }) => <Heading level={3}>{children}</Heading>,
          pre: ({ children }) => <Pre>{children}</Pre>,
          table: ({ children }) => (
            <div className={s.tableWrap}>
              <table>{children}</table>
            </div>
          ),
          a: ({ href = "", children }) => {
            // Cross-links between the Markdown files become site routes.
            const m = /^([a-z-]+)\.md(#.*)?$/.exec(href);
            const to = m ? `/docs${m[1] === "index" ? "" : `/${m[1]}`}${m[2] ?? ""}` : href;
            const external = /^https?:/.test(to);
            return (
              <a href={to} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
                {children}
              </a>
            );
          },
        }}
      >
        {personalize(md, origin)}
      </Markdown>
    </article>
  );
}
