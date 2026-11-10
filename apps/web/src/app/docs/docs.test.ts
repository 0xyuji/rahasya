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

test("the API docs' structured-output claim matches the catalog", () => {
  assert.match(DOCS["api.md"]!, /Structured output \(`response_format`\) \| Every model except the two TEE models/);
  for (const m of Object.values(MODELS)) assert.equal(m.structuredOutputs, !m.e2ee, m.key);
  assert.equal(Object.values(MODELS).filter((m) => m.e2ee).length, 2);
});

test("the npx version in the docs and the Local proxy menu matches the npm package", () => {
  const root = join(import.meta.dirname, "..", "..", "..", "..", "..");
  const { version } = JSON.parse(readFileSync(join(root, "packages", "proxy", "npm", "package.json"), "utf8")) as { version: string };
  const npx = `npx rahasya@${version}`;
  assert.ok(DOCS["api.md"]!.includes(npx));
  assert.ok(DOCS["agents.md"]!.includes(npx));
  assert.ok(readFileSync(join(import.meta.dirname, "..", "editor-dialog.tsx"), "utf8").includes(npx));
});
