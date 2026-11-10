import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { ANYWHERE_MACHINE, CREDIT_MACHINE, DepositBroadcastError, anywhereSteps, creditSteps, type CreditState } from "./machines.ts";
import { attemptGuard, walletSession, walletUid } from "../wallet/session.ts";
import type { Machine } from "@pay/rail/browser";

// flow.ts talks to localStorage, 1Click and a Base RPC: all faked here, before it loads.
const saved = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
  removeItem: (k: string) => void saved.delete(k),
  key: (i: number) => [...saved.keys()][i] ?? null,
  clear: () => saved.clear(),
  get length() {
    return saved.size;
  },
} as Storage;

let statuses: string[] = [];
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/v0/status")) return reply({ status: statuses.shift() ?? "PENDING_DEPOSIT", swapDetails: { destinationChainTxHashes: [{ hash: "0xdelivered" }] } });
  if (u.includes("/v0/deposit/submit")) return reply({});
  const rpc = JSON.parse(String(init?.body)) as { id: number };
  return reply({ jsonrpc: "2.0", id: rpc.id, result: `0x${(10n ** 12n).toString(16).padStart(64, "0")}` }); // USDC balance
}) as typeof fetch;

const { actions, confirmSweep, resend, runCredit, topUpOnce } = await import("./flow.ts");
const { checkAnywhereQuote } = await import("./anywhere.ts");
type CreditAction = import("./flow.ts").CreditAction;

const ADDRESS = "0x418abf35BE5F2078667b4996a67a37c5F7b8740D";
let n = 0;

function seed(state: CreditState): string {
  const deadline = new Date(Date.now() + 20 * 60_000).toISOString();
  const quoteRequest = { swapType: "EXACT_OUTPUT", originAsset: "o", destinationAsset: "d", amount: "5000000", refundTo: "r", recipient: ADDRESS, deadline };
  const id = `credit_${++n}`;
  actions.put({
    id,
    createdAt: new Date().toISOString(),
    state,
    usd: 5,
    source: { chain: "evm", address: ADDRESS },
    inferenceAddress: ADDRESS,
    origin: { chain: "base", symbol: "USDC", assetId: "o", decimals: 6, priceUsd: 1 },
    quoteRequest,
    quote: { quoteRequest, quote: { depositAddress: "dep", amountIn: "5100000", amountOut: "5000000", minAmountOut: "5000000", deadline } },
    history: [],
  } as never as CreditAction);
  return id;
}

function deps(send: () => Promise<string>, extra = {}) {
  const updates: CreditAction[] = [];
  return { updates, d: { send: send as never, inference: null, onUpdate: (a: CreditAction) => void updates.push(a), topUp: async () => {}, ...extra } };
}

const visited = (id: string) => actions.get(id)!.history.map((h) => h.state);

beforeEach(() => {
  statuses = [];
});

function assertSound<S extends string>(m: Machine<S>, start: S) {
  const seen = new Set<S>([start]);
  for (const s of seen) for (const next of m.transitions[s]) seen.add(next);
  assert.deepEqual([...seen].sort(), Object.keys(m.transitions).sort(), `${m.name}: unreachable state`);
}

test("funding machines: every state is reachable, finals are the documented ones", () => {
  assertSound(CREDIT_MACHINE, "QUOTED");
  assertSound(ANYWHERE_MACHINE, "AWAITING_DEPOSIT");
  assert.deepEqual([...CREDIT_MACHINE.final].sort(), ["DONE", "EXPIRED", "FAILED", "REFUNDED"]);
  assert.deepEqual([...ANYWHERE_MACHINE.final].sort(), ["CANCELLED", "DONE", "EXPIRED", "FAILED", "IDLE", "REFUNDED"]);
});

test("money can only be sent from QUOTED", () => {
  const into = (Object.keys(CREDIT_MACHINE.transitions) as CreditState[]).filter((s) => CREDIT_MACHINE.can(s, "SENDING"));
  assert.deepEqual(into, ["QUOTED"]);
});

test("reopening the dialog during a wallet prompt joins the run: one send, no false 'unconfirmed'", async () => {
  const id = seed("QUOTED");
  statuses = ["SUCCESS"];
  let sends = 0;
  let confirm!: (tx: string) => void;
  const send = () => (sends++, new Promise<string>((r) => (confirm = r)));
  const first = deps(send);
  const second = deps(send);
  const a = runCredit(id, first.d);
  await new Promise((r) => setImmediate(r));
  const b = runCredit(id, second.d);
  confirm("0xtx");
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(sends, 1);
  assert.equal(ra.state, "DONE");
  assert.equal(rb.state, "DONE");
  assert.ok(!visited(id).includes("SEND_UNCONFIRMED"));
  assert.ok(second.updates.some((u) => u.state === "DONE"), "the second caller gets live updates too");
});

test("'Keep waiting' finds a deposit that did land, and carries on without sending", async () => {
  const id = seed("SEND_UNCONFIRMED");
  statuses = ["PROCESSING", "SUCCESS"];
  let sends = 0;
  const done = await runCredit(id, deps(async () => (sends++, "0x")).d);
  assert.equal(done.state, "DONE");
  assert.equal(sends, 0);
});

test("an unconfirmed send with no deposit stays put for the user to decide", async () => {
  const id = seed("SEND_UNCONFIRMED");
  let sends = 0;
  assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "SEND_UNCONFIRMED");
  assert.equal(sends, 0);
  assert.equal(resend(id).state, "QUOTED", "only an explicit 'send again' goes back to QUOTED");
});

test("a declined wallet prompt returns to the quote, and its error doesn't follow the retry", async () => {
  const id = seed("QUOTED");
  const declined = await runCredit(id, deps(() => Promise.reject(new Error("User rejected the request"))).d);
  assert.equal(declined.state, "QUOTED");
  assert.match(declined.error!, /declined/);
  statuses = ["SUCCESS"];
  const done = await runCredit(id, deps(async () => "0xtx").d);
  assert.equal(done.state, "DONE");
  assert.equal(done.error, undefined);
});

test("a send that fails after broadcast keeps tracking the deposit and never offers to pay again", async () => {
  const id = seed("QUOTED");
  statuses = ["SUCCESS"];
  let sends = 0;
  const done = await runCredit(id, deps(async () => {
    sends++;
    throw new DepositBroadcastError("0xlanded", new Error("block height exceeded"));
  }).d);
  assert.equal(sends, 1);
  assert.equal(done.state, "DONE");
  assert.equal(done.depositTx, "0xlanded");
  assert.ok(!visited(id).slice(1).includes("QUOTED"));
});

test("a deposit 1Click never sees stops the wait and asks the user", async () => {
  const id = seed("DEPOSIT_SENT");
  statuses = ["PENDING_DEPOSIT"];
  let sends = 0;
  const stuck = await runCredit(id, deps(async () => (sends++, "0x"), { pendingDepositLimitMs: 0 }).d);
  assert.equal(stuck.state, "SEND_UNCONFIRMED");
  assert.equal(sends, 0);
});

test("a $0 sweep is success only if the USDC is already gone", async () => {
  await confirmSweep(5, async () => 10_000_000n);
  await confirmSweep(0, async () => 0n);
  await assert.rejects(confirmSweep(0, async () => 5_000_000n), /hasn't been credited/);
});

test("any-token quotes must echo the amount and not ask for more than the credit is worth", () => {
  const token = { decimals: 6, price: 1, symbol: "USDT" };
  const req = { originAsset: "a", destinationAsset: "b", recipient: "r", refundTo: "f", swapType: "FLEX_INPUT", amount: "5150000" };
  const ok = (quote: object, echo: object = req) => ({ quoteRequest: echo, quote: { depositAddress: "d", amountIn: "5150000", minAmountIn: "5000000", ...quote } }) as never;
  checkAnywhereQuote(req as never, ok({}), token, 5);
  const code = (f: () => void) => assert.throws(f, (e: { code: string }) => e.code === "QUOTE_MISMATCH");
  code(() => checkAnywhereQuote(req as never, ok({}, { ...req, amount: "9" }), token, 5));
  code(() => checkAnywhereQuote(req as never, ok({ amountIn: "6000000" }), token, 5));
  code(() => checkAnywhereQuote(req as never, ok({ minAmountIn: "6000000" }), token, 5));
  const inflated = { ...req, amount: "9000000" };
  assert.throws(() => checkAnywhereQuote(inflated as never, ok({ amountIn: "9000000", minAmountIn: "1" }, inflated), token, 5), /refusing to send/);
});

test("the API-keys session must belong to the connected wallet", () => {
  assert.equal(walletUid({ chain: "evm", address: "0xABC" }), "evm:0xabc");
  assert.equal(walletUid({ chain: "sol", address: "AbC" }), "sol:AbC");
  assert.equal(walletUid({ chain: "near", address: "a.near" }), "near:a.near");
});

test("cancelling a hung unlock frees the button and throws away a late signature", () => {
  const g = attemptGuard();
  const hung = g.begin()!;
  g.abandon();
  assert.ok(g.wasAbandoned(hung));
  const next = g.begin()!;
  assert.ok(next && !g.wasAbandoned(next));
});

test("progress list tells the truth in every failure", () => {
  assert.deepEqual(creditSteps({ state: "FAILED" }), ["fail", "todo", "todo"], "refused before sending: the swap didn't fail");
  assert.deepEqual(creditSteps({ state: "FAILED", depositTx: "0x" }), ["done", "fail", "todo"]);
  assert.deepEqual(creditSteps({ state: "REFUNDED" }), ["done", "fail", "todo"]);
  assert.deepEqual(creditSteps({ state: "SEND_UNCONFIRMED" }), ["now", "todo", "todo"]);
  assert.equal(anywhereSteps("EXPIRED"), null, "an expired address must not show 'deposit received'");
  assert.deepEqual(anywhereSteps("IDLE"), ["done", "done", "todo"]);
});

test("two watchers of one deposit share one top-up; the next attempt starts fresh", async () => {
  let runs = 0;
  let finish!: () => void;
  const run = () => (runs++, new Promise<void>((r) => (finish = r)));
  const a = topUpOnce("t1", run);
  const b = topUpOnce("t1", run);
  finish();
  await Promise.all([a, b]);
  assert.equal(runs, 1);
  const c = topUpOnce("t1", run);
  finish();
  await c;
  assert.equal(runs, 2);
});

test("wallet session: one unlock at a time, and a cancelled attempt frees the next", () => {
  assert.equal(walletSession(false, false, false), "disconnected");
  assert.equal(walletSession(true, false, false), "locked");
  assert.equal(walletSession(true, false, true), "unlocking");
  assert.equal(walletSession(true, true, false), "unlocked");
  const g = attemptGuard();
  const first = g.begin()!;
  assert.equal(g.begin(), null, "no second wallet prompt");
  g.cancel();
  assert.ok(!g.isCurrent(first));
  assert.ok(g.begin());
});
