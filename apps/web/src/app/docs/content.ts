import "server-only";
import { DOCS } from "./docs.generated.ts";

/** Docs live as Markdown in apps/web/content/docs, baked into docs.generated.ts at build time. */
export const PAGES = [
  { slug: "", file: "index.md", title: "Overview" },
  { slug: "integrations", file: "integrations.md", title: "Integrations" },
  { slug: "api", file: "api.md", title: "API reference" },
  { slug: "protocol", file: "protocol.md", title: "How it works" },
] as const;

export function readDoc(file: string): string {
  const md = DOCS[file];
  if (md === undefined) throw new Error(`Missing doc ${file}: run npm run docs:gen`);
  return md;
}
