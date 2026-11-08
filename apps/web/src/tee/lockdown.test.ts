import { strict as assert } from "node:assert";
import { test } from "node:test";

/**
 * The worker lockdown, emulated in Node: a worker-like global with storage and
 * network APIs on its prototype chain. (Runs in its own process via node --test.)
 */
const calls: string[] = [];
class Scope {}
Object.assign(Scope.prototype, {
  indexedDB: { open() {} },
  caches: {},
  XMLHttpRequest: class {},
  EventSource: class {},
  importScripts() {},
  BroadcastChannel: class {},
  WebSocketStream: class {},
});
// Worker-like navigator extras (Node's own navigator may or may not have them).
for (const name of ["serviceWorker", "locks", "storage"]) {
  try {
    Object.defineProperty(Object.getPrototypeOf(navigator), name, { configurable: true, get: () => ({ fake: name }) });
  } catch {}
}
Object.defineProperty(Scope.prototype, "fetch", {
  configurable: true,
  writable: true,
  value: async (url: string, init?: RequestInit) => (calls.push(`${init?.method ?? "GET"} ${url} credentials=${init?.credentials}`), new Response("ok")),
});
const g = globalThis as Record<string, unknown>;
delete g.fetch; // Node's own fetch would shadow the worker-style one on the prototype
Object.setPrototypeOf(globalThis, Scope.prototype);
g.self = globalThis;
g.location = { origin: "https://naisho.example" };
g.WebSocket = class {};

const { RELAY } = await import("./lockdown.ts");

test("storage and raw network APIs are gone, including from prototypes", () => {
  for (const name of ["indexedDB", "caches", "XMLHttpRequest", "EventSource", "importScripts", "BroadcastChannel", "WebSocket", "WebSocketStream", "Worker"]) {
    assert.equal(g[name], undefined, name);
    assert.equal(Object.getOwnPropertyDescriptor(Scope.prototype, name), undefined, `${name} on the prototype`);
    assert.throws(() => Object.defineProperty(globalThis, name, { value: 1 }), TypeError, `${name} can't be redefined`);
  }
});

test("navigator.storage, serviceWorker and locks are gone (other contexts of our origin)", () => {
  for (const name of ["storage", "serviceWorker", "locks"]) assert.equal((navigator as unknown as Record<string, unknown>)[name], undefined, name);
});

test("fetch only reaches the collateral relay, GET, without cookies", async () => {
  assert.equal(RELAY, "https://naisho.example/api/tee/pccs/");
  await fetch(`${RELAY}tdx/certification/v4/qe/identity?update=standard`);
  assert.deepEqual(calls, ["GET https://naisho.example/api/tee/pccs/tdx/certification/v4/qe/identity?update=standard credentials=omit"]);
  for (const url of ["https://evil.example/x", "https://naisho.example/api/keys", "https://naisho.example/api/tee/pccsX", "/api/account"]) {
    await assert.rejects(fetch(url), /limited to the collateral relay/, url);
  }
  await assert.rejects(fetch(`${RELAY}x`, { method: "POST", body: "{}" }), /limited/);
  assert.equal(calls.length, 1);
  assert.throws(() => Object.defineProperty(globalThis, "fetch", { value: async () => new Response() }), TypeError, "fetch can't be swapped back");
  assert.equal(Object.getOwnPropertyDescriptor(Scope.prototype, "fetch"), undefined, "the original fetch isn't reachable via the prototype");
});
