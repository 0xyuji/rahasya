/**
 * Which Intel-check failures may count as "couldn't check" instead of "fail"
 * (audit T-01). Kept apart from the worker so it can be tested in Node.
 */
import { Buffer } from "buffer"; // the same polyfill the library uses (no global Buffer in a browser worker)
import type * as Qvl from "@phala/dcap-qvl";

/**
 * Messages from @phala/dcap-qvl 0.7.1 that mean Intel's collateral (from our relay)
 * is stale or not yet valid: they say nothing about the quote. Matched exactly;
 * anything else, including a reworded message after a library upgrade, is a fail.
 * "Certificate is expired or not yet valid" is deliberately NOT here: the library
 * uses it for the PCK chain embedded in the quote too.
 */
export const STALE_COLLATERAL_MESSAGES = [
  "TCBInfo issue date is in the future",
  "TCBInfo expired",
  "QE Identity issue date is in the future",
  "QE Identity expired",
  "CRL is not yet valid",
  "CRL is expired",
] as const;

export function classifyVerifyError(message: string): "stale-collateral" | "fail" {
  return (STALE_COLLATERAL_MESSAGES as readonly string[]).includes(message.trim()) ? "stale-collateral" : "fail";
}

/**
 * Do what getCollateral does with the quote before it touches the network: parse it,
 * require an embedded PCK certificate chain (cert type 5; the encrypted-PPID types
 * would need a PCK cert from Intel, which our relay doesn't serve), and read the
 * FMSPC from the leaf certificate. Returns why the quote is unusable, or null.
 */
export function checkQuoteCertificates(qvl: typeof Qvl, quoteBytes: Uint8Array): string | null {
  try {
    // innerCertType() and PCK_ID_PCK_CERT_CHAIN exist in 0.7.1 but aren't in its typings.
    const quote = qvl.Quote.parse(quoteBytes) as unknown as { innerCertType(): number; rawCertChain(): Uint8Array };
    const chainType = (qvl.constants as unknown as { PCK_ID_PCK_CERT_CHAIN?: number }).PCK_ID_PCK_CERT_CHAIN ?? 5;
    const type = quote.innerCertType();
    if (type !== chainType) return `unsupported certification data type ${type}`;
    const certs = qvl.utils.extractCerts(Buffer.from(quote.rawCertChain()));
    if (!certs.length) return "the quote has no PCK certificate chain";
    qvl.utils.getFmspc(qvl.utils.getIntelExtension(certs[0]));
    (qvl.utils as unknown as { getCertIssuer(c: unknown): string }).getCertIssuer(certs[0]); // getCollateral reads it to pick the CA (untyped in 0.7.1)
    return null;
  } catch (err) {
    return `the quote's certificate data is invalid (${String((err as Error)?.message ?? err).slice(0, 120)})`;
  }
}

/**
 * A getCollateral failure, after checkQuoteCertificates passed. Only failures that say
 * nothing about the quote can be "unavailable": no network, our relay's limits, Intel's
 * rate limits or server errors. Everything else is "fail", including a message a future
 * library version words differently, so an upgrade can't quietly downgrade a forged quote.
 */
const COLLATERAL_UNAVAILABLE = [
  /^Failed to fetch( .*)?:\s*(429|5\d\d)\s*$/,
  /^Failed to fetch$/, // Chrome's network error
  /^NetworkError when attempting to fetch resource\.?$/, // Firefox
  /^Load failed$/, // Safari
  /^network access is limited to the collateral relay/, // our lockdown refusing
  /^collateral relay unreachable$/, // any transport or body failure, from the lockdown's fetch
  /^Missing (SGX-|TCB-)/, // a response header Intel or a proxy left off: about the reply, not the quote
  /^(Unexpected (token|end)|JSON\.parse|JSON Parse error)/, // an HTML error page where collateral should be
  /^(The operation timed out|signal timed out|The user aborted a request|The operation was aborted)\.?$/,
];
export function classifyCollateralError(message: string): "unavailable" | "fail" {
  return COLLATERAL_UNAVAILABLE.some((re) => re.test(message.trim())) ? "unavailable" : "fail";
}
