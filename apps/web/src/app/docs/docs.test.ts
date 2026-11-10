import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MODELS } from "@pay/rail/browser";
import { DOCS } from "./docs.generated.ts";

test("docs.generated.ts matches content/docs (run npm run docs:gen)", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "content", "docs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(Object.keys(DOCS).sort(), files);
  for (const f of files) assert.equal(DOCS[f], readFileSync(join(dir, f), "utf8"), `${f} is out of date`);
});

test("the agent guide's model table matches the catalog", () => {
  const rows = [...DOCS["agents.md"]!.matchAll(/^\| `([a-z0-9.-]+)` \| (yes|no) \|/gm)].map((m) => [m[1]!, m[2]!]);
  assert.deepEqual(rows.map(([id]) => id).sort(), Object.keys(MODELS).sort());
  for (const [id, tools] of rows) assert.equal(tools, MODELS[id]!.e2ee ? "no" : "yes", id);
});
