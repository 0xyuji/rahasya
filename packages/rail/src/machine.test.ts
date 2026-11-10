import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defineMachine, type Machine } from "./machine.ts";
import { SWAP_MACHINE } from "./swap/engine.ts";
import { RailError } from "./util.ts";

/** Every state can be reached from the start, and every non-final state has a way forward. */
function assertSound<S extends string>(m: Machine<S>, start: S): void {
  const seen = new Set<S>([start]);
  for (const s of seen) for (const next of m.transitions[s]) seen.add(next);
  assert.deepEqual([...seen].sort(), Object.keys(m.transitions).sort(), `${m.name}: unreachable state`);
}

test("a state with no exits is final; moves outside the table throw and name the machine", () => {
  const m = defineMachine<"A" | "B">("demo", { A: ["B"], B: [] });
  assert.deepEqual([...m.final], ["B"]);
  assert.ok(m.can("A", "B"));
  assert.ok(!m.can("B", "A"));
  m.assert("A", "B");
  assert.throws(() => m.assert("B", "A"), (e: RailError) => e.code === "ILLEGAL_TRANSITION" && /demo: B -> A/.test(e.message));
});

test("swap machine: all states reachable, finals are the documented ones", () => {
  assertSound(SWAP_MACHINE, "QUOTED");
  assert.deepEqual([...SWAP_MACHINE.final].sort(), ["CANCELLED", "EXPIRED", "FAILED", "NEEDS_REVIEW", "REFUNDED", "SUCCESS"]);
  assert.ok(!SWAP_MACHINE.can("SUCCESS", "DEPOSIT_SIGNED"), "a finished swap can never sign again");
});
