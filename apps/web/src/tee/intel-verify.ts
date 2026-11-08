"use client";

import type { QuoteVerdict } from "@pay/rail/browser";

/**
 * Verify a TDX quote's Intel signature chain in a throwaway, locked-down worker
 * (see intel-verify.worker.ts / lockdown.ts). Never throws and never blocks for
 * long: anything other than a clean, well-formed answer becomes "unavailable",
 * except an explicit failure from the verifier.
 */
const TIMEOUT_MS = 20_000;
const HEX = /^[0-9a-f]+$/i;

export function verifyIntelQuote(quoteHex: string): Promise<QuoteVerdict> {
  if (typeof Worker === "undefined") return Promise.resolve({ status: "unavailable", detail: "This browser can't run the check." });
  let worker: Worker;
  try {
    worker = new Worker(new URL("./intel-verify.worker.ts", import.meta.url), { type: "module", name: "intel-verify" });
  } catch {
    return Promise.resolve({ status: "unavailable", detail: "Couldn't start the verifier." });
  }
  return new Promise<QuoteVerdict>((resolve) => {
    const done = (v: QuoteVerdict) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(v);
    };
    const timer = setTimeout(() => done({ status: "unavailable", detail: "The check timed out. The other checks still apply." }), TIMEOUT_MS);
    worker.onerror = () => done({ status: "unavailable", detail: "The verifier crashed. The other checks still apply." });
    worker.onmessage = (e: MessageEvent) => done(parseVerdict(e.data));
    worker.postMessage({ quoteHex });
  });
}

/** Accept only the exact shape we expect from the worker. */
export function parseVerdict(d: unknown): QuoteVerdict {
  const v = (d ?? {}) as Record<string, unknown>;
  const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : undefined);
  const detail = str(v.detail, 400) ?? "";
  if (v.status === "fail") return { status: "fail", detail: detail || "Intel's signature check failed." };
  if (v.status !== "pass") return { status: "unavailable", detail: detail || "Couldn't check right now." };
  const reportDataHex = str(v.reportDataHex, 128);
  const mrTd = str(v.mrTd, 96);
  if (!reportDataHex || reportDataHex.length !== 128 || !HEX.test(reportDataHex) || (mrTd && !HEX.test(mrTd))) {
    return { status: "unavailable", detail: "The verifier returned an unexpected answer." };
  }
  return { status: "pass", detail, reportDataHex, tcbStatus: str(v.tcbStatus, 40), mrTd };
}
