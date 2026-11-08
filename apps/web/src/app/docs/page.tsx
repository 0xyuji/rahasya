import { readDoc } from "./content";
import { DocBody } from "./doc-body";

export const dynamic = "force-static";

export default function DocsHome() {
  return <DocBody md={readDoc("index.md")} />;
}
