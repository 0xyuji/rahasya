// Bundles the proxy CLI and everything it imports into one file that runs on plain
// Node (no TypeScript, no repo, no npm install): dist/rahasya.mjs, plus its SHA-256.
// Not minified, so anyone can read what they run. The website serves both files.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "dist", "rahasya.mjs");
await build({
  entryPoints: [join(root, "src", "cli.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "eof",
  logLevel: "warning",
  // Some dependencies are CommonJS and call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __rahasyaRequire } from 'node:module'; const require = __rahasyaRequire(import.meta.url);" },
});
const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
writeFileSync(`${out}.sha256`, `${sha}  rahasya.mjs\n`);
console.log(`${out}\n${(readFileSync(out).length / 1024).toFixed(0)} KB, sha256 ${sha}`);
