/// <reference lib="webworker" />
/**
 * Verifies an Intel TDX quote's DCAP signature chain with @phala/dcap-qvl
 * (pinned version), isolated from the page:
 *  - `./lockdown` is imported first, so storage and network are gone before the
 *    library is evaluated;
 *  - the worker gets only the quote (public) and returns only a small verdict,
 *    which the page re-validates field by field.
 *
 * "unavailable" (doesn't block) is reserved for failures that say nothing about
 * the quote: our relay or Intel being unreachable, or Intel's collateral being
 * stale. Anything about the quote itself is "fail" (audit T-01). Otherwise the
 * quote's producer could break its own certificate section and turn a forged
 * enclave from "fail" into "couldn't check".
 */
import { RELAY } from "./lockdown";
import * as qvl from "@phala/dcap-qvl";
import { checkQuoteCertificates, classifyCollateralError, classifyVerifyError } from "./intel-classify";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 160);

self.onmessage = async (e: MessageEvent<{ quoteHex?: unknown }>) => {
  const reply = (v: Record<string, unknown>) => self.postMessage(v);
  const hex = e.data?.quoteHex;
  if (typeof hex !== "string" || hex.length % 2 || hex.length > 64_000 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return reply({ status: "fail", detail: "The quote isn't valid hex." });
  }
  const quote = Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

  // 1. Everything getCollateral would read from the quote, before any network: a quote
  //    we can't parse, or one without a usable embedded PCK chain, fails here.
  const bad = checkQuoteCertificates(qvl, quote);
  if (bad) return reply({ status: "fail", detail: `Intel's signature check failed: ${bad}.` });

  // 2. Collateral. The quote has been checked, so an error now is about the relay or
  //    Intel's data, not the quote.
  let collateral: Awaited<ReturnType<typeof qvl.getCollateral>>;
  try {
    collateral = await qvl.getCollateral(RELAY, quote);
  } catch (err) {
    if (classifyCollateralError(msg(err)) === "fail") {
      return reply({ status: "fail", detail: `Intel has no certificate data for the platform this quote claims (${msg(err)}).` });
    }
    return reply({ status: "unavailable", detail: `Couldn't get Intel's certificate data right now (${msg(err)}). The other checks still apply.` });
  }

  // 3. Signatures, chain, revocation, TCB.
  let verified: ReturnType<typeof qvl.verify>;
  try {
    verified = qvl.verify(quote, collateral, Math.floor(Date.now() / 1000));
  } catch (err) {
    const m = msg(err);
    if (classifyVerifyError(m) === "stale-collateral") {
      return reply({ status: "unavailable", detail: `Intel's certificate data is out of date (${m}). The other checks still apply.` });
    }
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
