/// <reference lib="webworker" />
/**
 * Runs first in the Intel-verifier worker, before the third-party library is
 * evaluated (it is this module's first import). It takes away everything a
 * compromised library could use to reach secrets or our API:
 *
 *  - storage: indexedDB (WalletConnect keeps sessions there), caches, the
 *    origin-private file system. (Workers never see localStorage, cookies'
 *    contents or the page's memory, where the inference key lives.)
 *  - network: XMLHttpRequest, WebSocket, WebTransport, EventSource, and nested
 *    workers. fetch is replaced by one that only GETs our public collateral relay,
 *    without cookies, so it can't call our API as the signed-in user.
 *
 * Properties are removed from the whole prototype chain, then pinned as
 * non-configurable, so they can't be recovered from a prototype.
 */
export const RELAY = new URL("/api/tee/pccs/", self.location.origin).href;

const realFetch = self.fetch.bind(self);

const BLOCKED = [
  "indexedDB",
  "caches",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "importScripts",
  "fetch",
] as const;

function strip(name: string) {
  for (let o: object | null = self; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d?.configurable) delete (o as Record<string, unknown>)[name];
  }
}

for (const name of BLOCKED) strip(name);
for (const name of BLOCKED) {
  if (name === "fetch") continue;
  try {
    Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
  } catch {}
}

// navigator.storage gives access to the origin-private file system.
try {
  for (let o: object | null = navigator; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, "storage");
    if (d?.configurable) delete (o as Record<string, unknown>).storage;
  }
  Object.defineProperty(navigator, "storage", { value: undefined, writable: false, configurable: false });
} catch {}

const relayOnly = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), self.location.origin);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || !url.href.startsWith(RELAY)) return Promise.reject(new TypeError("network access is limited to the collateral relay"));
  return realFetch(url.href, { method: "GET", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
};

Object.defineProperty(self, "fetch", { value: relayOnly, writable: false, configurable: false });
