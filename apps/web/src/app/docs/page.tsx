import type { Metadata } from "next";
import { OVERVIEW, readDoc } from "./content";
import { DocBody } from "./doc-body";

export const dynamic = "force-static";

export const metadata: Metadata = { description: OVERVIEW };

export default function DocsHome() {
  return <DocBody md={readDoc("index.md")} />;
}
