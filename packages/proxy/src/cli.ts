#!/usr/bin/env node
/**
 * rahasya         — first run: ask for your inference wallet key, then serve
 * rahasya login   — save your inference wallet key (hidden input) to ~/.rahasya
 * rahasya serve   — run the local OpenAI-compatible proxy on 127.0.0.1
 * rahasya token   — print (or --rotate) the local access token
 * rahasya balance — show your credit
 */
import { JsonStore, VeniceClient, type TopUpAction } from "@pay/rail";
import { privateKeyToAccount } from "viem/accounts";
import { home, loadInferenceKey, loadOrCreateToken, rotateToken, saveInferenceKey } from "./config.ts";
import { createProxy } from "./server.ts";

const CREDIT_URL = process.env.RAHASYA_SITE_URL ?? "the website (account menu → Add credit)";
const [cmd = "start", ...args] = process.argv.slice(2);

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
  saveInferenceKey(key);
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

function serve() {
  const port = Number(args[args.indexOf("--port") + 1]) || Number(process.env.RAHASYA_PORT) || 8787;
  const v = venice();
  const token = loadOrCreateToken();
  const server = createProxy({
    venice: v,
    token,
    creditUrl: CREDIT_URL,
    log: (l) => console.log(`${new Date().toISOString().slice(11, 19)} ${l}`),
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`Port ${port} is already in use by another program. Try: rahasya serve --port ${port + 1}`);
    else console.error(e.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", async () => {
    let credit = "?";
    try {
      credit = `$${(await v.balance()).balanceUsd.toFixed(4)}`;
    } catch {}
    console.log(`
  Local proxy running (only reachable from this machine)

    Base URL   http://127.0.0.1:${port}/v1
    API key    ${token}
    Wallet     ${v.address}
    Credit     ${credit}

  Point any OpenAI-compatible tool at the base URL with that API key.
  Models: GET /v1/models  (e.g. large-v2, large-flash, deepseek-1017-uncensored, deepseek-abliterated-tee)
  Prompts are never logged. Ctrl+C to stop.
`);
  });
}
