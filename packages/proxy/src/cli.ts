#!/usr/bin/env node
/**
 * rahasya          first run: ask for your inference wallet key, then serve
 * rahasya login    save your inference wallet key (hidden input) to ~/.rahasya
 * rahasya serve    run the local OpenAI-compatible proxy on 127.0.0.1
 * rahasya token    print (or --rotate) the local access token
 * rahasya balance  show your credit
 */
import { JsonStore, VeniceClient, type TopUpAction } from "@pay/rail";
import { privateKeyToAccount } from "viem/accounts";
import { home, loadInferenceKey, loadOrCreateToken, rotateToken, saveInferenceKey } from "./config.ts";
import { createProxy } from "./server.ts";

const CREDIT_URL = process.env.RAHASYA_SITE_URL ?? "the website (account menu → Add credit)";
// `node rahasya.mjs --port 9000` means "start on that port"; only --help shows usage.
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith("-") ? argv[0] : argv.includes("--help") || argv.includes("-h") ? "help" : "start";
const args = cmd === argv[0] ? argv.slice(1) : argv;

function venice(): VeniceClient {
  const key = loadInferenceKey();
  if (!key) {
    console.error("No inference key yet. Run `rahasya` (or `rahasya login`) first. Copy the key from the website: account menu → Local proxy.");
    process.exit(1);
  }
  return new VeniceClient({ account: privateKeyToAccount(key), topups: new JsonStore<TopUpAction>(home(), "topups"), maxTopUpUsd: 0.01 });
}

async function readHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const c of stdin) data += c;
    return data.trim();
  }
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let s = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(s.trim());
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        s = s.slice(0, -1);
      } else {
        s += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function login() {
  const key = await readHidden("Paste your inference wallet key (input hidden): ");
  try {
    saveInferenceKey(key);
  } catch (e) {
    console.error(`${(e as Error).message} Copy it from the website: account menu → Local proxy → Copy key.`);
    process.exit(1);
  }
  const address = privateKeyToAccount(key as `0x${string}`).address;
  console.log(`Saved to ${home()} (only your user can read it). Inference wallet: ${address}`);
}

if (cmd === "start") {
  // One command for everything: ask for the key the first time, then serve.
  if (!loadInferenceKey()) {
    console.log("First run. Copy your inference key from the website: account menu → Local proxy → Copy key.");
    await login();
  }
  serve();
} else if (cmd === "login") {
  await login();
} else if (cmd === "token") {
  console.log(args.includes("--rotate") ? rotateToken() : loadOrCreateToken());
} else if (cmd === "balance") {
  const b = await venice().balance();
  console.log(`Credit: $${b.balanceUsd.toFixed(4)}${b.canConsume ? "" : " (add credit to use it)"}`);
} else if (cmd === "serve") {
  serve();
} else {
  console.log(`usage:
  rahasya                  first run: asks for your inference wallet key, then serves
  rahasya serve [--port N] run the local OpenAI-compatible proxy (default port 8787)
  rahasya login            save (or replace) your inference wallet key
  rahasya token [--rotate] print or rotate the local access token
  rahasya balance          show your credit`);
}

/** `--port N`, a bare number (`serve 9000`), or RAHASYA_PORT; 0 means "any free port". */
function pickPort(): number {
  const i = args.indexOf("--port");
  const eq = args.find((a) => a.startsWith("--port="));
  const raw = eq !== undefined ? eq.slice("--port=".length) : i >= 0 ? (args[i + 1] ?? "") : (args.find((a) => /^\d+$/.test(a)) ?? (process.env.RAHASYA_PORT || undefined));
  if (raw === undefined) return 8787;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN; // digits only: no "", "0x50" or "1e3"
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    console.error(`Not a port number: ${raw}. Use a number from 0 to 65535, e.g. rahasya serve --port 8788`);
    process.exit(1);
  }
  return n;
}

function serve() {
  const port = pickPort();
  const v = venice();
  const token = loadOrCreateToken();
  const server = createProxy({
    venice: v,
    token,
    creditUrl: CREDIT_URL,
    log: (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`),
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`Port ${port} is already in use by another program. Try: rahasya serve --port ${port >= 65535 ? 8788 : port + 1}`);
    else console.error(e.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", async () => {
    const addr = server.address();
    const bound = addr && typeof addr === "object" ? addr.port : port; // --port 0 picks a free port
    let credit = "?";
    try {
      credit = `$${(await v.balance()).balanceUsd.toFixed(4)}`;
    } catch {}
    console.log(`
  Local proxy running (only reachable from this machine)

    Base URL   http://127.0.0.1:${bound}/v1
    API key    ${token}
    Wallet     ${v.address}
    Credit     ${credit}

  Point any OpenAI-compatible tool at the base URL with that API key.
  Models: GET /v1/models  (e.g. large-v2, large-flash, deepseek-1017-uncensored, deepseek-abliterated-tee)
  Prompts are never logged. Ctrl+C to stop.
`);
  });
}
