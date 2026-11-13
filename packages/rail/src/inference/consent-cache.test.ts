/**
 * Audit v4 A-15: "send without the Intel check" is remembered for 60 s from the attestation it was
 * given for, and reusing that report must not renew the window. Real VeniceChat; the attestation
 * fetch returns the captured fixture (echoing our nonce) and Intel answers "couldn't check".
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { VeniceChat } from "./chat.ts";

const fixture = JSON.parse(readFileSync(new URL("../venice/fixtures/attestation-gemma-tee.json", import.meta.url), "utf8"));

test("A-15: the consent window runs 60 s from the attestation and isn't renewed by each message", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-13T00:00:00Z") });
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async (url: string | URL) => {
    fetches++;
    const nonce = new URL(String(url)).searchParams.get("nonce");
    return new Response(JSON.stringify({ ...fixture, nonce }));
  }) as typeof fetch;
  try {
    const venice = { authHeaders: async () => ({}), chatStream: async () => Promise.reject(new Error("not reached")) };
    const chat = new VeniceChat({ venice: venice as never, verifyQuote: async () => ({ status: "unavailable" as const, detail: "Intel is down" }) });
    let asks = 0;
    let accepted = false; // what use-chat keeps per enclave after the user says yes
    const send = () =>
      chat
        .stream({
          mode: "private",
          model: "gemma-4-26b-tee",
          messages: [{ role: "user", content: "x" }],
          confirmUnverified: async () => (asks++, (accepted = true)),
          unverifiedAccepted: () => accepted,
        })
        .catch(() => undefined); // the fixture's quote doesn't bind our nonce, so nothing is sent: we only watch the consent logic

    await send(); // t = 0: attest, re-attest once, then ask
    assert.equal(asks, 1);
    const afterFirst = fetches;

    mock.timers.tick(30_000);
    await send(); // t = 30 s: reuses the accepted report, no new attestation, no question
    mock.timers.tick(29_000);
    await send(); // t = 59 s: still inside the window that started at t = 0
    assert.equal(fetches, afterFirst, "no attestation inside the 60 s window");
    assert.equal(asks, 1);

    mock.timers.tick(2_000);
    await send(); // t = 61 s: the sends at 30 s and 59 s did not extend it, so this re-attests
    assert.equal(fetches, afterFirst + 1, "the window was not renewed by reuse");
    assert.equal(asks, 1, "the user already accepted this enclave; no new question");
  } finally {
    globalThis.fetch = realFetch;
    mock.timers.reset();
  }
});
