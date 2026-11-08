import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DOCS } from "./docs.generated.ts";

test("docs.generated.ts matches content/docs (run npm run docs:gen)", () => {
  const dir = join(import.meta.dirname, "..", "..", "..", "content", "docs");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(Object.keys(DOCS).sort(), files);
  for (const f of files) assert.equal(DOCS[f], readFileSync(join(dir, f), "utf8"), `${f} is out of date`);
});
