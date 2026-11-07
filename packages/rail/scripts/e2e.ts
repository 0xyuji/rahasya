/**
 * End-to-end rail test on mainnet:
 *   SOL on Solana --1Click EXACT_OUTPUT--> USDC on our own Base address --x402--> Venice credit --> one chat call
 *
 *   node --env-file=../../.env scripts/e2e.ts dry           # keyless-friendly: dry quote only, nothing minted or sent
 *   node --env-file=../../.env scripts/e2e.ts quote         # binding quote (mints deposit address), prints it, sends nothing
 *   node --env-file=../../.env scripts/e2e.ts run [swapId]  # executes the saved quote, tops up Venice, one cheap chat
 *
 * `run` is resumable: re-running it after a crash continues from the persisted state; nothing is sent twice.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { resolveAsset } from "../src/assets.ts";
import { BaseDepositor } from "../src/chains/base.ts";
import { SolanaDepositor } from "../src/chains/solana.ts";
import { loadConfig } from "../src/config.ts";
import { createLogger } from "../src/log.ts";
import { OneClickClient } from "../src/oneclick/client.ts";
import { JsonStore } from "../src/store.ts";
import { SwapEngine, type SwapAction } from "../src/swap/engine.ts";
import { randomActionId, sleep } from "../src/util.ts";
import { VeniceClient, type TopUpAction } from "../src/venice/client.ts";

const TOPUP_USD = 5; // Venice minimum
const CHEAP_MODEL = "olafangensan-glm-4.7-flash-heretic"; // $0.07 / $0.40 per 1M — cheapest allowed

const cfg = loadConfig();
const log = createLogger(cfg.LOG_LEVEL, "e2e");
const dataDir = resolve(import.meta.dirname, "../../../data");
const lastFile = resolve(dataDir, "e2e-last.json");

const oneclick = new OneClickClient({ baseUrl: cfg.ONECLICK_BASE_URL, apiKey: cfg.ONECLICK_API_KEY });
const base = new BaseDepositor(cfg.BASE_PRIVATE_KEY as `0x${string}`, cfg.BASE_RPC_URL);
if (!cfg.SOLANA_SECRET_KEY) throw new Error("SOLANA_SECRET_KEY missing");
const sol = await SolanaDepositor.create(cfg.SOLANA_SECRET_KEY, cfg.SOLANA_RPC_URL);
const killed = () => cfg.KILL_SWITCH === "1";

const engine = new SwapEngine({
  oneclick,
  depositors: { sol, base },
  store: new JsonStore<SwapAction>(dataDir, "swaps"),
  slippageBps: cfg.SWAP_SLIPPAGE_BPS,
  maxSwapUsd: cfg.MAX_SWAP_USD,
  isKilled: killed,
  log,
});
const venice = new VeniceClient({
  account: privateKeyToAccount(cfg.BASE_PRIVATE_KEY as `0x${string}`),
  topups: new JsonStore<TopUpAction>(dataDir, "topups"),
  maxTopUpUsd: cfg.MAX_TOPUP_USD,
  isKilled: killed,
  log,
});

const intent = {
  from: { chain: "sol" as const, symbol: "SOL" as const },
  to: { chain: "base" as const, symbol: "USDC" as const },
  mode: "EXACT_OUTPUT" as const,
  amount: TOPUP_USD.toFixed(6),
  recipient: base.address,
};

function printQuote(a: SwapAction) {
  const q = a.quote!.quote;
  console.log(`
  ┌ swap ${a.id}
  │ send     ${q.amountInFormatted} SOL  (~$${q.amountInUsd})  — min used ${Number(q.minAmountIn) / 1e9} SOL, excess refunded
  │ receive  ${q.amountOutFormatted} USDC on Base (~$${q.amountOutUsd})  → ${a.intent.recipient}
  │ from     ${a.refundTo} (Solana; refunds go here)
  │ deposit  ${q.depositAddress}
  │ deadline ${q.deadline}   est. ${q.timeEstimate}s after deposit confirms
  └ 1Click correlationId ${a.quote!.correlationId}`);
}

const [cmd = "dry", argId] = process.argv.slice(2);

if (cmd === "dry") {
  const tokens = await oneclick.tokens();
  const o = resolveAsset(tokens, "sol", "SOL");
  const d = resolveAsset(tokens, "base", "USDC");
  const res = await oneclick.quote({
    dry: true,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: cfg.SWAP_SLIPPAGE_BPS,
    originAsset: o.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: d.assetId,
    amount: (BigInt(TOPUP_USD) * 1_000_000n).toString(),
    refundTo: sol.address,
    refundType: "ORIGIN_CHAIN",
    recipient: base.address,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  console.log("dry quote:", {
    send: `${res.quote.amountInFormatted} SOL (~$${res.quote.amountInUsd})`,
    receive: `${res.quote.amountOutFormatted} USDC`,
    timeEstimateSec: res.quote.timeEstimate,
  });
} else if (cmd === "quote") {
  const solBal = await sol.balance(resolveAsset(await oneclick.tokens(), "sol", "SOL"));
  console.log(`Solana burner ${sol.address}: ${Number(solBal) / 1e9} SOL`);
  const a = await engine.quote(randomActionId("swap"), intent);
  printQuote(a);
  writeFileSync(lastFile, JSON.stringify({ swapId: a.id }));
  console.log(`\nNothing sent. To execute: node --env-file=../../.env scripts/e2e.ts run ${a.id}`);
} else if (cmd === "run") {
  const swapId = argId ?? (existsSync(lastFile) ? (JSON.parse(readFileSync(lastFile, "utf8")) as { swapId: string }).swapId : undefined);
  if (!swapId) throw new Error("no swap id; run `quote` first");
  const t0 = Date.now();
  const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`;

  // 1) Swap (skip if USDC already there from an earlier run)
  const need = BigInt(TOPUP_USD) * 1_000_000n;
  let usdc = await base.usdcBalance();
  const topupId = `topup_${swapId}`;
  const priorTopup = new JsonStore<TopUpAction>(dataDir, "topups").get(topupId);
  if (usdc < need && priorTopup?.state !== "SUCCESS") {
    const swap = await engine.execute(swapId, (e) => console.log(`${stamp()} [swap ${e.action.state}] ${e.message}`));
    if (swap.state !== "SUCCESS") {
      console.log(`swap ended in ${swap.state}${swap.error ? ` (${swap.error.code}: ${swap.error.message})` : ""}. Re-run \`run\` to resume if not final.`);
      process.exit(1);
    }
    for (const t of swap.swapDetails?.destinationChainTxHashes ?? []) console.log(`${stamp()} delivered: ${t.explorerUrl || `https://basescan.org/tx/${t.hash}`}`);
    for (const t of swap.swapDetails?.originChainTxHashes ?? []) console.log(`${stamp()} deposit:   ${t.explorerUrl || `https://solscan.io/tx/${t.hash}`}`);
    // 1Click SUCCESS means the payout tx exists; wait for our RPC to see it.
    for (let i = 0; i < 30 && (usdc = await base.usdcBalance()) < need; i++) await sleep(2000);
  }
  console.log(`${stamp()} Base USDC balance: ${Number(usdc) / 1e6}`);

  // 2) Venice top-up via x402 (idempotent per id)
  const bal0 = await venice.balance();
  console.log(`${stamp()} Venice balance before: $${bal0.balanceUsd}`);
  if (priorTopup?.state !== "SUCCESS") {
    const t = await venice.topUp(topupId, TOPUP_USD);
    console.log(`${stamp()} top-up ${t.state}`, JSON.stringify(t.response).slice(0, 300));
  }
  const bal1 = await venice.balance();
  console.log(`${stamp()} Venice balance after: $${bal1.balanceUsd} (canConsume=${bal1.canConsume})`);

  // 3) One cheap chat call
  const r = await venice.chat({
    model: CHEAP_MODEL,
    messages: [{ role: "user", content: "Reply with exactly: rail works" }],
    max_tokens: 50,
    // Reasoning models otherwise spend the whole budget "thinking" and return "".
    venice_parameters: { include_venice_system_prompt: false, disable_thinking: true },
  });
  console.log(`${stamp()} chat (${CHEAP_MODEL}):`, JSON.stringify(r.choices[0]?.message?.content), r.usage ?? "");
  console.log(`${stamp()} X-Balance-Remaining: $${venice.lastBalanceUsd ?? "n/a"}`);
} else {
  console.log("usage: e2e.ts dry | quote | run [swapId]");
}
