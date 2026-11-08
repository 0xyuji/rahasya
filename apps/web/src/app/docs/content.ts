import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Docs live as Markdown in apps/web/content/docs and are read at build time (static pages). */
export const PAGES = [
  { slug: "", file: "index.md", title: "Overview" },
  { slug: "integrations", file: "integrations.md", title: "Integrations" },
  { slug: "api", file: "api.md", title: "API reference" },
  { slug: "protocol", file: "protocol.md", title: "How it works" },
] as const;

export function readDoc(file: string): string {
  return readFileSync(join(process.cwd(), "content", "docs", file), "utf8");
}
