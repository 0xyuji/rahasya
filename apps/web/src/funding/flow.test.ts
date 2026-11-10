import { strict as assert } from "node:assert";
import { beforeEach, test } from "node:test";
import { ANYWHERE_FINAL, ANYWHERE_MACHINE, CREDIT_MACHINE, DepositBroadcastError, DepositNotSentError, anywhereSteps, creditSteps, type CreditState } from "./machines.ts";
import { attemptGuard, recoverSigner, solanaSignatureValid, walletSession, walletUid } from "../wallet/session.ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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
let onStatus: (() => Response | undefined) | undefined;
const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const u = String(url);
  const scripted = u.includes("/v0/status") ? onStatus?.() : undefined;
  if (scripted) return scripted;
  if (u.includes("/v0/status")) return reply({ status: statuses.shift() ?? "PENDING_DEPOSIT", swapDetails: { destinationChainTxHashes: [{ hash: "0xdelivered" }] }, quoteResponse: { quote: { depositAddress: "dep", amountIn: "5100000" }, quoteRequest: { recipient: ADDRESS } } });
  if (u.includes("/v0/deposit/submit")) return reply({});
  const rpc = JSON.parse(String(init?.body)) as { id: number };
  return reply({ jsonrpc: "2.0", id: rpc.id, result: `0x${(10n ** 12n).toString(16).padStart(64, "0")}` }); // USDC balance
}) as typeof fetch;

const { actions, confirmSweep, dismiss, recoverResend, resend, runCredit, topUpOnce } = await import("./flow.ts");
const { anywhereActions, checkAnywhereQuote, isEvmChain, recheckClosed, refundAddressProblem, runAnywhere } = await import("./anywhere.ts");
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
  onStatus = undefined;
});

function assertSound<S extends string>(m: Machine<S>, start: S) {
  const seen = new Set<S>([start]);
  for (const s of seen) for (const next of m.transitions[s]) seen.add(next);
  assert.deepEqual([...seen].sort(), Object.keys(m.transitions).sort(), `${m.name}: unreachable state`);
}

test("funding machines: every state is reachable, finals are the documented ones", () => {
  assertSound(CREDIT_MACHINE, "QUOTED");
  assertSound(ANYWHERE_MACHINE, "AWAITING_DEPOSIT");
  assert.deepEqual([...CREDIT_MACHINE.final].sort(), ["DISMISSED", "DONE", "EXPIRED", "FAILED", "REFUNDED"]);
  assert.deepEqual([...ANYWHERE_FINAL].sort(), ["CANCELLED", "DONE", "EXPIRED", "FAILED", "IDLE", "REFUNDED"]);
});

test("money can only be sent from QUOTED", () => {
  const into = (Object.keys(CREDIT_MACHINE.transitions) as CreditState[]).filter((s) => CREDIT_MACHINE.can(s, "SENDING"));
  assert.deepEqual(into, ["QUOTED"]);
});

test("reopening the dialog during a wallet prompt joins the run: one send, no false 'unconfirmed'", async () => {
  const id = seed("QUOTED");
  statuses = ["PENDING_DEPOSIT", "SUCCESS"];
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
  statuses = ["PENDING_DEPOSIT", "SUCCESS"];
  const done = await runCredit(id, deps(async () => "0xtx").d);
  assert.equal(done.state, "DONE");
  assert.equal(done.error, undefined);
});

test("a send that fails after broadcast keeps tracking the deposit and never offers to pay again", async () => {
  const id = seed("QUOTED");
  statuses = ["PENDING_DEPOSIT", "SUCCESS"];
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

test("an unclear wallet error may have broadcast: never offer 'Confirm and send' again", async () => {
  const id = seed("QUOTED");
  let sends = 0;
  const a = await runCredit(id, deps(async () => {
    sends++;
    throw new Error("Request expired. Please try again.");
  }).d);
  assert.equal(a.state, "SEND_UNCONFIRMED");
  assert.equal(sends, 1);
  assert.doesNotMatch(a.error!, /Nothing was sent/);
});

test("provably unsent errors do go back to the quote", async () => {
  for (const err of [new DepositNotSentError("reverted"), Object.assign(new Error("x"), { code: 4001 }), new Error("outer", { cause: Object.assign(new Error("inner"), { name: "UserRejectedRequestError" }) })]) {
    assert.equal((await runCredit(seed("QUOTED"), deps(() => Promise.reject(err)).d)).state, "QUOTED");
  }
});

test("never pays into an address 1Click already has a deposit for", async () => {
  const id = seed("QUOTED");
  statuses = ["PROCESSING", "SUCCESS"];
  let sends = 0;
  assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "DONE");
  assert.equal(sends, 0);
});

test("'Send again' keeps the first hash, re-checks 1Click and refuses if it can't", async () => {
  const id = seed("SEND_UNCONFIRMED");
  actions.put({ ...actions.get(id)!, depositTx: "0xfirst" });
  let sends = 0;
  resend(id);
  onStatus = () => new Response("{}", { status: 400 }); // 1Click unreachable
  const refused = await runCredit(id, deps(async () => (sends++, "0x")).d);
  assert.equal(refused.state, "SEND_UNCONFIRMED");
  assert.equal(sends, 0);
  assert.equal(refused.depositTx, "0xfirst");
  assert.deepEqual(refused.priorTxs, ["0xfirst"]);
});

test("a declined 'Send again' keeps watching instead of dropping back to a quote nobody resumes", async () => {
  const id = seed("SEND_UNCONFIRMED");
  resend(id);
  assert.equal((await runCredit(id, deps(() => Promise.reject(new Error("User rejected the request"))).d)).state, "SEND_UNCONFIRMED");
});

test("a deposit the wallet saw mined is never offered 'Send again'", async () => {
  const id = seed("QUOTED");
  statuses = ["PENDING_DEPOSIT", "PENDING_DEPOSIT", "SUCCESS"];
  const done = await runCredit(id, deps(async () => "0xmined", { pendingDepositLimitMs: 0 }).d);
  assert.equal(done.state, "SWAPPING", "stops polling, but stays on 'keep waiting or stop tracking'");
  assert.match(done.error!, /Don't send it again/);
  assert.ok(!visited(id).includes("SEND_UNCONFIRMED"));
  assert.equal(dismiss(id).state, "DISMISSED", "and it can always be stopped");
});

test("a deposit that was really sent is recorded even if another tab moved the action", async () => {
  const id = seed("QUOTED");
  statuses = ["PENDING_DEPOSIT", "SUCCESS"];
  let sends = 0;
  const send = async () => {
    sends++;
    const now = actions.get(id)!; // tab 2 resumed SENDING and decided it was unconfirmed
    actions.put({ ...now, state: "SEND_UNCONFIRMED", history: [...now.history, { at: "t", state: "SEND_UNCONFIRMED" }] });
    return "0xmined";
  };
  const done = await runCredit(id, deps(send).d);
  assert.equal(done.state, "DONE");
  assert.equal(done.depositTx, "0xmined");
  assert.equal(sends, 1);
});

test("a 1Click reply with no status isn't taken for a deposit, and nothing is sent on it", async () => {
  const id = seed("QUOTED");
  onStatus = () => reply({});
  let sends = 0;
  const a = await runCredit(id, deps(async () => (sends++, "0x")).d);
  assert.equal(a.state, "QUOTED");
  assert.match(a.error!, /couldn't confirm/);
  assert.equal(sends, 0);
});

test("K32: a failed read never lets a send through (unknown address, rate limit, outage)", async () => {
  for (const status of [404, 429, 500]) {
    const id = seed("QUOTED");
    onStatus = () => new Response("{}", { status });
    let sends = 0;
    assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "QUOTED", String(status));
    assert.equal(sends, 0, String(status));
  }
});

test("a reload between 'Send again' and the prompt goes back to watching, without sending", () => {
  const id = seed("SEND_UNCONFIRMED");
  assert.equal(recoverResend(resend(id)).state, "SEND_UNCONFIRMED");
});

test("a stale tab can't overwrite a broadcast record", async () => {
  const id = seed("QUOTED");
  statuses = ["PENDING_DEPOSIT"];
  const send = async () => {
    const now = actions.get(id)!; // another tab records its broadcast while this prompt is open
    actions.put({ ...now, state: "DEPOSIT_SENT", depositTx: "0xother", history: [...now.history, { at: "t", state: "DEPOSIT_SENT" }] });
    throw new Error("User rejected the request");
  };
  await assert.rejects(runCredit(id, deps(send).d), /another tab/);
  assert.equal(actions.get(id)!.state, "DEPOSIT_SENT");
  assert.equal(actions.get(id)!.depositTx, "0xother");
});

test("unparseable deadlines are refused, not treated as never expiring", async () => {
  const id = seed("QUOTED");
  const a = actions.get(id)!;
  actions.put({ ...a, quoteRequest: { ...a.quoteRequest, deadline: "not-a-date" } });
  let sends = 0;
  assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "FAILED");
  assert.equal(sends, 0);
});

test("stuck actions can be dismissed, and dismissing sends nothing", () => {
  assert.equal(dismiss(seed("TOPPING_UP")).state, "DISMISSED");
  assert.equal(dismiss(seed("SEND_UNCONFIRMED")).state, "DISMISSED");
});

test("a failed status read never expires an any-token deposit", async () => {
  const past = new Date(Date.now() - 10 * 60_000).toISOString();
  const quoteRequest = { deadline: past };
  const a = anywhereActions.put({ id: `any_${++n}`, kind: "anywhere", createdAt: "t", state: "AWAITING_DEPOSIT", token: {}, refundTo: "r", inferenceAddress: ADDRESS, quoteRequest, quote: { quoteRequest, quote: { depositAddress: "d", deadline: past } }, history: [] } as never);
  const stop = new AbortController();
  onStatus = () => (stop.abort(), new Response("{}", { status: 400 }));
  assert.notEqual((await runAnywhere(a.id, { inference: null, onUpdate: () => {}, signal: stop.signal, topUp: async () => {} })).state, "EXPIRED");
});

test("an EVM address is refused as a refund address on non-EVM chains", () => {
  for (const chain of ["starknet", "sui", "aptos", "tron", "xrp", "doge"]) assert.ok(refundAddressProblem(chain, ADDRESS), chain);
  assert.equal(refundAddressProblem("arb", ADDRESS), null);
  assert.equal(refundAddressProblem("hypercore", ADDRESS), null);
  assert.equal(refundAddressProblem("qtc", ADDRESS), null, "chains we can't classify aren't refused");
  assert.equal(isEvmChain("qtc"), false, "but the connected address isn't prefilled there");
});

test("K32: a saved quote that differs from 1Click's own copy is refused before sending", async () => {
  const id = seed("QUOTED");
  onStatus = () => reply({ status: "PENDING_DEPOSIT", quoteResponse: { quote: { depositAddress: "attacker" }, quoteRequest: { recipient: ADDRESS } } });
  let sends = 0;
  const a = await runCredit(id, deps(async () => (sends++, "0x")).d);
  assert.equal(a.state, "FAILED");
  assert.equal(sends, 0);
});

test("K32: a matching copy goes through, whatever the address casing", async () => {
  const id = seed("QUOTED");
  let reads = 0;
  onStatus = () => (reads++ ? reply({ status: "SUCCESS", swapDetails: {} }) : reply({ status: "PENDING_DEPOSIT", quoteResponse: { quote: { depositAddress: "DEP", amountIn: "5100000" }, quoteRequest: { recipient: ADDRESS.toLowerCase() } } }));
  let sends = 0;
  assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "DONE");
  assert.equal(sends, 1);
});

test("K31: a deposit that lands after expiry or cancel is picked up when the panel opens", async () => {
  const inferenceAddress = `0x${"ab".repeat(20)}`;
  const quoteRequest = { deadline: "t" };
  const a = anywhereActions.put({ id: `late_${++n}`, kind: "anywhere", createdAt: new Date().toISOString(), state: "EXPIRED", token: {}, refundTo: "r", inferenceAddress, quoteRequest, quote: { quoteRequest, quote: { depositAddress: "d" } }, history: [] } as never);
  statuses = ["PENDING_DEPOSIT"];
  assert.equal(await recheckClosed(inferenceAddress), undefined, "nothing arrived yet");
  statuses = ["SUCCESS"];
  const late = await recheckClosed(inferenceAddress);
  assert.equal(late?.id, a.id);
  assert.equal(late?.state, "SWAPPED");
});

test("a partial deposit finished after the deadline is picked up, not left looking lost", async () => {
  const inferenceAddress = `0x${"cd".repeat(20)}`;
  const past = new Date(Date.now() - 3600_000).toISOString();
  const quoteRequest = { deadline: past };
  const a = anywhereActions.put({ id: `partial_${++n}`, kind: "anywhere", createdAt: new Date().toISOString(), state: "INCOMPLETE", token: {}, refundTo: "r", inferenceAddress, quoteRequest, quote: { quoteRequest, quote: { depositAddress: "d", deadline: past } }, history: [] } as never);
  statuses = ["INCOMPLETE_DEPOSIT"];
  assert.equal(await recheckClosed(inferenceAddress), undefined, "still partial: no state change");
  statuses = ["SUCCESS"];
  assert.equal((await recheckClosed(inferenceAddress))?.id, a.id);
});

test("after 'Send again', a quote 1Click can't vouch for goes back to watching, not to the quote screen", async () => {
  for (const r of [reply({ status: "PENDING_DEPOSIT" }), reply({ status: "PENDING_DEPOSIT", quoteResponse: { quote: { depositAddress: "other" } } })]) {
    const id = seed("SEND_UNCONFIRMED");
    resend(id);
    onStatus = () => r.clone();
    let sends = 0;
    assert.equal((await runCredit(id, deps(async () => (sends++, "0x")).d)).state, "SEND_UNCONFIRMED");
    assert.equal(sends, 0);
  }
});

test("K29: the unlock signature must come from the connected account", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const sig = await signer.signMessage({ message: "m" });
  assert.equal(await recoverSigner("m", sig), signer.address.toLowerCase());
  assert.notEqual(await recoverSigner("m", sig), ADDRESS.toLowerCase());
  assert.equal(await recoverSigner("m", "0x1234"), null, "an odd encoding isn't treated as the wrong signer");
  const priv = ed25519.utils.randomPrivateKey();
  const msg = new TextEncoder().encode("m");
  const good = ed25519.sign(msg, priv);
  assert.equal(solanaSignatureValid(good, msg, ed25519.getPublicKey(priv)), true);
  assert.equal(solanaSignatureValid(good, msg, ed25519.getPublicKey(ed25519.utils.randomPrivateKey())), false);
  assert.equal(solanaSignatureValid(new Uint8Array(3), msg, ed25519.getPublicKey(priv)), false);
});

test("a corrupted saved record is skipped instead of crashing the dialogs", () => {
  saved.set("iw:credit:broken", "{not json");
  saved.set("iw:credit:partial", JSON.stringify({ id: "partial", state: "SWAPPING" }));
  try {
    assert.ok(actions.all().every((a) => a.id !== "partial"));
    assert.equal(actions.get("broken"), undefined);
  } finally {
    saved.delete("iw:credit:broken");
    saved.delete("iw:credit:partial");
  }
});

test("a $0 sweep is success only if the USDC is already gone", async () => {
  await confirmSweep(5, async () => 10_000_000n, 5);
  await assert.rejects(confirmSweep(5, async () => 20_000_000n, 25), /hasn't been credited/); // an old, smaller authorization settled
  await confirmSweep(0, async () => 0n);
  await assert.rejects(confirmSweep(0, async () => 5_000_000n), /hasn't been credited/);
});

test("any-token quotes must echo the amount and not ask for more than the credit is worth", () => {
  const token = { decimals: 6, price: 1, symbol: "USDT" };
  const req = { originAsset: "a", destinationAsset: "b", recipient: "r", refundTo: "f", swapType: "FLEX_INPUT", amount: "5150000" };
  const ok = (quote: object, echo: object = req) => ({ quoteRequest: echo, quote: { depositAddress: "d", amountIn: "5150000", minAmountIn: "5000000", minAmountOut: "5000000", ...quote } }) as never;
  checkAnywhereQuote(req as never, ok({}), token, 5);
  const code = (f: () => void) => assert.throws(f, (e: { code: string }) => e.code === "QUOTE_MISMATCH");
  code(() => checkAnywhereQuote(req as never, ok({}, { ...req, amount: "9" }), token, 5));
  code(() => checkAnywhereQuote(req as never, ok({ amountIn: "6000000" }), token, 5));
  code(() => checkAnywhereQuote(req as never, ok({ minAmountIn: "6000000" }), token, 5));
  const inflated = { ...req, amount: "9000000" };
  assert.throws(() => checkAnywhereQuote(inflated as never, ok({ amountIn: "9000000", minAmountIn: "1", minAmountOut: "5000000" }, inflated), token, 5), /refusing to send/);
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
