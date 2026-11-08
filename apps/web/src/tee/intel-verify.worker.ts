/// <reference lib="webworker" />
/**
 * Verifies an Intel TDX quote's DCAP signature chain with @phala/dcap-qvl
 * (pinned version), isolated from the page:
 *  - `./lockdown` is imported first, so storage and network are gone before the
 *    library is evaluated;
 *  - the worker gets only the quote (public) and returns only a small verdict,
 *    which the page re-validates field by field.
 */
import { RELAY } from "./lockdown";
import * as qvl from "@phala/dcap-qvl";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

self.onmessage = async (e: MessageEvent<{ quoteHex?: unknown }>) => {
  const reply = (v: Record<string, unknown>) => self.postMessage(v);
  const hex = e.data?.quoteHex;
  if (typeof hex !== "string" || hex.length % 2 || hex.length > 64_000 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return reply({ status: "fail", detail: "The quote isn't valid hex." });
  }
  const quote = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

  let collateral: Awaited<ReturnType<typeof qvl.getCollateral>>;
  try {
    collateral = await qvl.getCollateral(RELAY, quote);
  } catch (err) {
    return reply({ status: "unavailable", detail: `Couldn't get Intel's certificate data right now (${msg(err)}). The other checks still apply.` });
  }

  let verified: ReturnType<typeof qvl.verify>;
  try {
    verified = qvl.verify(quote, collateral, Math.floor(Date.now() / 1000));
  } catch (err) {
    const m = msg(err);
    // Stale or not-yet-valid collateral says nothing about the quote: our copy (or the clock) is off.
    if (/expired|in the future/i.test(m)) return reply({ status: "unavailable", detail: `Intel's certificate data is out of date (${m}). The other checks still apply.` });
    return reply({ status: "fail", detail: `Intel's signature check failed: ${m}.` });
  }

  const td = verified.report.asTd10();
  if (!td) return reply({ status: "fail", detail: "The verified quote isn't an Intel TDX report." });
  const advisories = verified.advisory_ids?.length ? `; Intel advisories: ${verified.advisory_ids.slice(0, 6).join(", ")}` : "";
  reply({
    status: "pass",
    detail: `Signed by real Intel TDX hardware: the quote's signature, Intel's certificate chain and revocation lists were verified in your browser. Platform security level: ${verified.status}${advisories}.`,
    reportDataHex: toHex(td.reportData),
    tcbStatus: verified.status,
    mrTd: toHex(td.mrTd),
  });
};
