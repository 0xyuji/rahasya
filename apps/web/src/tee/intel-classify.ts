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
 * A getCollateral failure, after checkQuoteCertificates passed. Intel answering
 * "not found" (our relay passes Intel's 404 through) means it has no collateral for
 * the FMSPC in the quote's certificate: a fabricated platform, so "fail". Network
 * errors, rate limits and server errors are "unavailable".
 */
export function classifyCollateralError(message: string): "unavailable" | "fail" {
  const status = /:\s*(\d{3})\s*$/.exec(message)?.[1];
  if (status && status.startsWith("4") && status !== "429") return "fail";
  return "unavailable";
}
