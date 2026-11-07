"use client";

import type { NearConnector } from "@hot-labs/near-connect";

let connector: Promise<NearConnector> | undefined;

/** Lazily create one NEAR connector (it touches window/IndexedDB, so client-only). */
export function nearConnector(): Promise<NearConnector> {
  connector ??= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "mainnet", autoConnect: true }));
  return connector;
}
