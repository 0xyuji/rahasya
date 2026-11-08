import { RailError } from "../util.ts";
import type { QuoteRequest, QuoteResponse } from "./types.ts";

/**
 * Code decides: never trust the quote blindly. The response must echo exactly
 * what we asked for, or we refuse to deposit.
 */
export function validateQuote(req: QuoteRequest, res: QuoteResponse): void {
  const echoed = res.quoteRequest;
  const mismatches: string[] = [];
  for (const k of ["originAsset", "destinationAsset", "recipient", "refundTo", "swapType", "amount"] as const) {
    if (String(echoed?.[k]).toLowerCase() !== String(req[k]).toLowerCase()) mismatches.push(k);
  }
  const q = res.quote;
  if (!q?.depositAddress) mismatches.push("depositAddress(missing)");
  if (q?.depositMemo) mismatches.push("depositMemo(unsupported)");
  if (req.swapType === "EXACT_INPUT" && q?.amountIn !== req.amount) mismatches.push("amountIn");
  if (req.swapType === "EXACT_OUTPUT" && BigInt(q?.amountOut ?? "0") < BigInt(req.amount)) mismatches.push("amountOut");
  if (BigInt(q?.minAmountOut ?? "0") <= 0n) mismatches.push("minAmountOut");
  if (BigInt(q?.amountIn ?? "0") <= 0n) mismatches.push("amountIn<=0");
  if (mismatches.length) {
    throw new RailError("QUOTE_MISMATCH", `1Click quote doesn't match the request: ${mismatches.join(", ")}`, {
      mismatches,
      correlationId: res.correlationId,
    });
  }
}

/**
 * Upper bound on what we'll send for a quote, priced independently of the
 * quote itself (token list price x amountIn), so an inflated `amountIn` with a
 * matching fake `amountInUsd` is still refused. Allows `maxOverPct` for
 * slippage + fees, plus a small fixed allowance for network fees on tiny swaps.
 */
export function checkMaxInput(
  origin: { decimals: number; priceUsd: number; symbol?: string },
  amountIn: string,
  usdWanted: number,
  maxOverPct = 0.05,
): void {
  const units = Number(BigInt(amountIn)) / 10 ** origin.decimals;
  const valueUsd = units * origin.priceUsd;
  const ceiling = usdWanted * (1 + maxOverPct) + 0.5;
  if (!(origin.priceUsd > 0) || !Number.isFinite(valueUsd) || valueUsd > ceiling) {
    throw new RailError(
      "QUOTE_TOO_EXPENSIVE",
      `The quote asks for ${units} ${origin.symbol ?? ""} (~$${valueUsd.toFixed(2)}) for $${usdWanted} of credit; refusing to send more than ~$${ceiling.toFixed(2)}.`,
    );
  }
}
