/**
 * Builds dist/naisho-audit-kit-<commit>.zip: the audit-kit/ docs at the top level plus a
 * source/ snapshot made with `git archive` (tracked files only, so .env files, data/ and
 * node_modules can't end up in it). Refuses to run with uncommitted changes, so the
 * snapshot always matches COMMIT.txt. Then scans the result for anything secret-shaped.
 *
 *   npm run audit:pack
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8" });

if (run("git", ["status", "--porcelain"]).trim()) {
  console.error("Uncommitted changes. Commit first so the snapshot matches the commit id.");
  process.exit(1);
}
const commit = run("git", ["rev-parse", "--short", "HEAD"]).trim();
const name = `naisho-audit-kit-${commit}`;
const dist = join(root, "dist");
const stage = join(dist, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "source"), { recursive: true });

// 1. Kit docs at the top level.
cpSync(join(root, "audit-kit"), stage, { recursive: true });

// 2. Source snapshot from git (tracked files only).
const tar = join(dist, `${name}.tar`);
run("git", ["archive", "--format=tar", `--output=${tar}`, "HEAD"]);
run("tar", ["-xf", tar, "-C", join(stage, "source")]);
rmSync(tar);
writeFileSync(
  join(stage, "source", "COMMIT.txt"),
  `${run("git", ["rev-parse", "HEAD"]).trim()}\n${run("git", ["log", "-1", "--format=%cI %s"]).trim()}\n`,
);

// 3. Secret scan: no env files, nothing that looks like a private key or token.
const bad: string[] = [];
const patterns: [string, RegExp][] = [
  ["env file", /(^|\/)\.env(\.(?!example$)[^/]*)?$/],
];
const content: [string, RegExp][] = [
  ["hex private key assignment", /(PRIVATE_KEY|SECRET|_TOKEN|ENC_KEY)\s*=\s*["']?[A-Za-z0-9+/=_-]{20,}/],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Upstash token", /\bA[A-Za-z0-9]{30,}=?\b(?=.*upstash)/i],
];
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(stage)) {
  const rel = file.slice(stage.length + 1);
  for (const [label, re] of patterns) if (re.test(rel)) bad.push(`${rel}: ${label}`);
  if (statSync(file).size > 2_000_000) continue;
  const text = readFileSync(file, "utf8");
  for (const [label, re] of content) if (re.test(text)) bad.push(`${rel}: ${label}`);
}
if (bad.length) {
  console.error("Refusing to pack. Secret-like content found:\n  " + bad.join("\n  "));
  rmSync(stage, { recursive: true, force: true });
  process.exit(1);
}

// 4. Zip.
const zip = join(dist, `${name}.zip`);
if (existsSync(zip)) rmSync(zip);
run("zip", ["-qr", `${name}.zip`, name], dist);
rmSync(stage, { recursive: true, force: true });
const files = run("zipinfo", ["-1", zip]).split("\n").filter((l) => l && !l.endsWith("/")).length;
console.log(`${zip}\n${files} files, ${(statSync(zip).size / 1024).toFixed(0)} KB, commit ${commit}, secret scan clean`);
