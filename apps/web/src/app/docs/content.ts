import "server-only";
import { DOCS } from "./docs.generated.ts";

export const OVERVIEW =
  "Private AI chat and an OpenAI-compatible API for uncensored models, paid with any token through NEAR Intents, with an optional TEE mode whose attestation is checked in the browser.";

/** Docs live as Markdown in apps/web/content/docs, baked into docs.generated.ts at build time. Descriptions become each page's meta description. */
export const PAGES = [
  { slug: "", file: "index.md", title: "Overview", description: OVERVIEW },
  {
    slug: "agents",
    file: "agents.md",
    title: "For AI agents",
    raw: "/agents.md",
    description: "Everything a coding agent needs to use Rahasya: base URL, models, request rules, errors, and when to ask a person.",
  },
  {
    slug: "integrations",
    file: "integrations.md",
    title: "Integrations",
    description: "Set up opencode, Cursor, Continue, Cline, Aider, Zed, SillyTavern, Open WebUI and LiteLLM with a Rahasya API key or the local proxy.",
  },
  {
    slug: "api",
    file: "api.md",
    title: "API reference",
    description: "Rahasya's OpenAI-compatible API: endpoints, models, live prices, per-key spend limits, errors, and what is stored.",
  },
  {
    slug: "protocol",
    file: "protocol.md",
    title: "How it works",
    description: "How Rahasya works: NEAR Intents funding, x402 credit, SIWX payments, TEE attestation and end-to-end encryption, and who can see what.",
  },
] as const;

export function readDoc(file: string): string {
  const md = DOCS[file];
  if (md === undefined) throw new Error(`Missing doc ${file}: run npm run docs:gen`);
  return md;
}
