import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ResolvedAsset } from "../assets.ts";
import type { DepositCheck, Depositor, PreparedDeposit } from "../chains/types.ts";
import type { ExecutionStatus, QuoteRequest, QuoteResponse, TokenResponse } from "../oneclick/types.ts";
import { JsonStore } from "../store.ts";
import { RailError } from "../util.ts";
import { SwapEngine, validateQuote, type SwapAction, type SwapIntent } from "./engine.ts";

const TOKENS: TokenResponse[] = [
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 90, priceUpdatedAt: "" },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    price: 1,
    priceUpdatedAt: "",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
];

const INTENT: SwapIntent = {
  from: { chain: "sol", symbol: "SOL" },
  to: { chain: "base", symbol: "USDC" },
  mode: "EXACT_OUTPUT",
  amount: "5",
  recipient: "0x418abf35BE5F2078667b4996a67a37c5F7b8740D",
};

function fakeOneClick(statuses: ExecutionStatus[], tamper?: (r: QuoteResponse) => void) {
  const calls = { quote: 0, status: 0, submit: 0 };
  let i = 0;
  const client = {
    calls,
    tokens: async () => TOKENS,
    quote: async (req: QuoteRequest): Promise<QuoteResponse> => {
      calls.quote++;
      const r: QuoteResponse = {
        correlationId: "c1",
        timestamp: new Date().toISOString(),
        signature: "sig",
        quoteRequest: { ...req },
        quote: {
          depositAddress: "DepositAddr111",
          amountIn: "56652587",
          amountInFormatted: "0.056652587",
          amountInUsd: "5.07",
          minAmountIn: "56086061",
          amountOut: req.amount,
          amountOutFormatted: "5.0",
          amountOutUsd: "5.0",
          minAmountOut: req.amount,
          deadline: new Date(Date.now() + 3600_000).toISOString(),
          timeEstimate: 22,
        },
      };
      tamper?.(r);
      return r;
    },
    status: async () => {
      calls.status++;
      const status = statuses[Math.min(i++, statuses.length - 1)]!;
      return {
        correlationId: "c1",
        quoteResponse: {} as QuoteResponse,
        status,
        updatedAt: "",
        swapDetails: {
          intentHashes: [],
          nearTxHashes: [],
          originChainTxHashes: [],
          destinationChainTxHashes: [],
          amountOutFormatted: status === "SUCCESS" ? "5.0" : undefined,
          refundedAmountFormatted: status === "REFUNDED" ? "0.0566" : undefined,
        },
      };
    },
    submitDeposit: async () => {
      calls.submit++;
      return {} as never;
    },
  };
  return client;
}

function fakeDepositor(opts: { checks?: DepositCheck[]; failFirstBroadcast?: boolean } = {}) {
  const calls = { prepare: 0, broadcast: [] as string[], check: 0 };
  let c = 0;
  const d: Depositor & { calls: typeof calls } = {
    chain: "sol",
    address: "SoLRefund111",
    calls,
    balance: async () => 10n ** 9n,
    prepare: async (asset: ResolvedAsset, to: string, amount: bigint): Promise<PreparedDeposit> => {
      calls.prepare++;
      return { chain: "sol", from: "SoLRefund111", to, assetId: asset.assetId, amount: amount.toString(), txHash: `tx${calls.prepare}`, raw: `raw${calls.prepare}` };
    },
    broadcast: async (p) => {
      calls.broadcast.push(p.raw);
      if (opts.failFirstBroadcast && calls.broadcast.length === 1) throw new TypeError("fetch failed");
    },
    check: async () => {
      calls.check++;
      const seq = opts.checks ?? ["confirmed"];
      return seq[Math.min(c++, seq.length - 1)]!;
    },
  };
  return d;
}

const FAST = { depositPollMs: 1, statusPollMs: 1, statusPollMaxMs: 1, depositTimeoutMs: 2_000, statusTimeoutMs: 2_000 };

function engine(oc: ReturnType<typeof fakeOneClick>, dep: Depositor, extra: { killed?: boolean } = {}) {
  const store = new JsonStore<SwapAction>(mkdtempSync(join(tmpdir(), "rail-test-")), "swaps");
  return new SwapEngine({
    oneclick: oc as never,
    depositors: { sol: dep },
    store,
    slippageBps: 100,
    maxSwapUsd: 25,
    isKilled: () => !!extra.killed,
    timing: FAST,
  });
}

test("happy path: quote -> deposit -> SUCCESS, one signed tx", async () => {
  const oc = fakeOneClick(["PENDING_DEPOSIT", "PROCESSING", "SUCCESS"]);
  const dep = fakeDepositor();
  const e = engine(oc, dep);
  await e.quote("s1", INTENT);
  const states: string[] = [];
  const a = await e.execute("s1", (ev) => states.push(ev.action.state));
  assert.equal(a.state, "SUCCESS");
  assert.equal(dep.calls.prepare, 1);
  assert.deepEqual(dep.calls.broadcast, ["raw1"]);
  assert.ok(states.includes("PROCESSING"), "reports progress states");
  assert.deepEqual(
    a.history.map((h) => h.state),
    ["QUOTED", "DEPOSIT_SIGNED", "DEPOSIT_SENT", "DEPOSIT_CONFIRMED", "PROCESSING", "SUCCESS"],
  );
});

test("quote is idempotent per action id", async () => {
  const oc = fakeOneClick(["SUCCESS"]);
  const e = engine(oc, fakeDepositor());
  await e.quote("s1", INTENT);
  await e.quote("s1", INTENT);
  assert.equal(oc.calls.quote, 1);
});

test("a failed broadcast is settled by the chain and never signs a second transaction", async () => {
  const oc = fakeOneClick(["SUCCESS"]);
  const dep = fakeDepositor({ failFirstBroadcast: true });
  const e = engine(oc, dep);
  await e.quote("s1", INTENT);
  const a = await e.execute("s1");
  assert.equal(a.state, "SUCCESS");
  assert.equal(dep.calls.prepare, 1, "signed exactly once");
  assert.ok(dep.calls.broadcast.every((raw: string) => raw === "raw1"), "only ever the same signed bytes");
});

test("concurrent execute calls share one run", async () => {
  const oc = fakeOneClick(["PROCESSING", "SUCCESS"]);
  const dep = fakeDepositor();
  const e = engine(oc, dep);
  await e.quote("s1", INTENT);
  const [a, b] = await Promise.all([e.execute("s1"), e.execute("s1")]);
  assert.equal(a.state, "SUCCESS");
  assert.equal(b.state, "SUCCESS");
  assert.equal(dep.calls.prepare, 1);
});

test("dropped deposit (provably never landed) is re-signed once", async () => {
  const oc = fakeOneClick(["PENDING_DEPOSIT", "SUCCESS"]);
  const dep = fakeDepositor({ checks: ["dropped", "dropped", "confirmed"] });
  const e = engine(oc, dep);
  await e.quote("s1", INTENT);
  const a = await e.execute("s1");
  assert.equal(a.state, "SUCCESS");
  assert.equal(dep.calls.prepare, 2);
  assert.equal(a.deposit!.raw, "raw2");
});

test("one false 'dropped' from a lagging RPC doesn't sign again", async () => {
  const dep = fakeDepositor({ checks: ["dropped", "confirmed"] });
  const e = engine(fakeOneClick(["SUCCESS"]), dep);
  await e.quote("s1", INTENT);
  assert.equal((await e.execute("s1")).state, "SUCCESS");
  assert.equal(dep.calls.prepare, 1);
});

test("'dropped' twice still doesn't sign again if 1Click sees the deposit", async () => {
  const dep = fakeDepositor({ checks: ["dropped", "dropped"] });
  const e = engine(fakeOneClick(["KNOWN_DEPOSIT_TX", "SUCCESS"]), dep);
  await e.quote("s1", INTENT);
  assert.equal((await e.execute("s1")).state, "SUCCESS");
  assert.equal(dep.calls.prepare, 1);
});

test("the swap cap prices the input from the token list, not the quote's own claim", async () => {
  const oc = fakeOneClick(["SUCCESS"], (r) => void (r.quote.amountIn = "5665258700"));
  await assert.rejects(engine(oc, fakeDepositor()).quote("s1", INTENT), (e: { code: string }) => e.code === "OVER_CAP");
});

test("nonce conflict pauses for review instead of guessing", async () => {
  const e = engine(fakeOneClick(["SUCCESS"]), fakeDepositor({ checks: ["conflict"] }));
  await e.quote("s1", INTENT);
  assert.equal((await e.execute("s1")).state, "NEEDS_REVIEW");
});

test("refund is reported as REFUNDED", async () => {
  const e = engine(fakeOneClick(["PROCESSING", "REFUNDED"]), fakeDepositor());
  await e.quote("s1", INTENT);
  assert.equal((await e.execute("s1")).state, "REFUNDED");
});

test("kill switch blocks before anything is signed", async () => {
  const dep = fakeDepositor();
  const e = engine(fakeOneClick(["SUCCESS"]), dep, { killed: true });
  await e.quote("s1", INTENT);
  await assert.rejects(e.execute("s1"), (err: RailError) => err.code === "KILLED");
  assert.equal(dep.calls.prepare, 0);
});

test("spend cap rejects oversized swaps at quote time", async () => {
  const oc = fakeOneClick(["SUCCESS"], (r) => (r.quote.amountInUsd = "999"));
  await assert.rejects(engine(oc, fakeDepositor()).quote("s1", INTENT), (err: RailError) => err.code === "OVER_CAP");
});

test("quote that doesn't echo our recipient is refused", async () => {
  const oc = fakeOneClick(["SUCCESS"], (r) => (r.quoteRequest.recipient = "0xattacker"));
  await assert.rejects(engine(oc, fakeDepositor()).quote("s1", INTENT), (err: RailError) => err.code === "QUOTE_MISMATCH");
});

test("validateQuote: EXACT_OUTPUT must deliver at least the requested amount", () => {
  const req = { swapType: "EXACT_OUTPUT", amount: "5000000", originAsset: "a", destinationAsset: "b", recipient: "r", refundTo: "f" } as QuoteRequest;
  const res = {
    correlationId: "c",
    quoteRequest: req,
    quote: { depositAddress: "d", amountIn: "1", amountOut: "4999999", minAmountOut: "4999999" },
  } as QuoteResponse;
  assert.throws(() => validateQuote(req, res), (e: RailError) => e.code === "QUOTE_MISMATCH");
});
