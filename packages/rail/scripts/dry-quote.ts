/**
 * No keys, no funds: ask NEAR Intents 1Click what it would take to deliver
 * $5 of USDC on Base from a few different assets (dry quotes mint nothing).
 *
 *   npm run quote:dry
 */
import { getBase58Decoder } from "@solana/kit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { resolveAsset } from "../src/assets.ts";
import { OneClickClient } from "../src/oneclick/client.ts";

const oc = new OneClickClient();
const tokens = await oc.tokens();
const dest = resolveAsset(tokens, "base", "USDC");
// Fresh random (never funded) addresses: dry quotes only check format.
const DUMMY = {
  base: privateKeyToAccount(generatePrivateKey()).address,
  sol: getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32))),
  near: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
} as const;
const origins = [
  { chain: "sol", symbol: "SOL", refund: DUMMY.sol },
  { chain: "base", symbol: "ETH", refund: DUMMY.base },
  { chain: "near", symbol: "NEAR", refund: DUMMY.near },
] as const;

console.log(`${tokens.length} tokens on ${new Set(tokens.map((t) => t.blockchain)).size} chains available through 1Click.\n`);
for (const o of origins) {
  const origin = resolveAsset(tokens, o.chain, o.symbol);
  try {
    const q = await oc.quote({
      dry: true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 50,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: dest.assetId,
      amount: "5000000",
      refundTo: o.refund,
      refundType: "ORIGIN_CHAIN",
      recipient: DUMMY.base,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    console.log(`  ${o.symbol.padEnd(5)} on ${o.chain.padEnd(5)} → send ${q.quote.amountInFormatted} (~$${Number(q.quote.amountInUsd).toFixed(2)}) for 5.0 USDC on Base, ~${q.quote.timeEstimate}s`);
  } catch (e) {
    console.log(`  ${o.symbol} on ${o.chain}: ${(e as Error).message.slice(0, 120)}`);
  }
}
