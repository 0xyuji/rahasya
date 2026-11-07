import type { TokenResponse } from "./oneclick/types.ts";
import { RailError } from "./util.ts";

/**
 * Deliberately narrow scope: every (chain, symbol) pair here must be tested
 * end to end. Adding one means adding it to the e2e matrix too.
 */
export const CHAINS = ["near", "base", "sol", "btc", "zec"] as const;
export type Chain = (typeof CHAINS)[number];

export const SYMBOLS = ["USDC", "SOL", "ETH", "NEAR", "BTC", "ZEC"] as const;
export type SymbolName = (typeof SYMBOLS)[number];

/** Which symbols are valid on which chain (as swap origin or destination). */
export const SUPPORTED: Record<Chain, readonly SymbolName[]> = {
  near: ["NEAR", "USDC"],
  base: ["ETH", "USDC"],
  sol: ["SOL", "USDC"],
  btc: ["BTC"],
  zec: ["ZEC"],
};

/** Chains we can actually send a deposit from today (we hold a key + depositor). */
export const DEPOSIT_CHAINS: readonly Chain[] = ["base", "sol"];

const CHAIN_ALIASES: Record<string, Chain> = {
  near: "near",
  base: "base",
  sol: "sol",
  solana: "sol",
  btc: "btc",
  bitcoin: "btc",
  zec: "zec",
  zcash: "zec",
};

export function parseChain(s: string): Chain | undefined {
  return CHAIN_ALIASES[s.trim().toLowerCase()];
}

export function parseSymbol(s: string): SymbolName | undefined {
  const u = s.trim().toUpperCase();
  const normalized = u === "WNEAR" ? "NEAR" : u;
  return (SYMBOLS as readonly string[]).includes(normalized) ? (normalized as SymbolName) : undefined;
}

export const CHAIN_LABEL: Record<Chain, string> = {
  near: "NEAR",
  base: "Base",
  sol: "Solana",
  btc: "Bitcoin",
  zec: "Zcash",
};

/** 1Click symbol for our symbol on a chain (NEAR is listed as wNEAR). */
const ONECLICK_SYMBOL: Partial<Record<`${Chain}:${SymbolName}`, string>> = {
  "near:NEAR": "wNEAR",
};

/**
 * Canonical contracts, pinned so a look-alike token in the 1Click list can
 * never be picked. Native assets have no pin.
 */
const PINNED_CONTRACT: Partial<Record<`${Chain}:${SymbolName}`, string>> = {
  "base:USDC": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "sol:USDC": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "near:USDC": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};

export interface ResolvedAsset {
  chain: Chain;
  symbol: SymbolName;
  assetId: string;
  decimals: number;
  priceUsd: number;
  contractAddress?: string;
  /** True for the chain's gas token (ETH on Base, SOL on Solana, ...). */
  native: boolean;
}

export function isSupported(chain: Chain, symbol: SymbolName): boolean {
  return SUPPORTED[chain].includes(symbol);
}

export function resolveAsset(tokens: TokenResponse[], chain: Chain, symbol: SymbolName): ResolvedAsset {
  if (!isSupported(chain, symbol)) {
    throw new RailError("UNSUPPORTED_ASSET", `${symbol} on ${CHAIN_LABEL[chain]} is not supported`);
  }
  const key = `${chain}:${symbol}` as const;
  const ocSymbol = (ONECLICK_SYMBOL[key] ?? symbol).toUpperCase();
  let matches = tokens.filter((t) => t.blockchain === chain && t.symbol.toUpperCase() === ocSymbol);

  const pin = PINNED_CONTRACT[key];
  if (pin) {
    matches = matches.filter((t) => t.contractAddress?.toLowerCase() === pin.toLowerCase());
  } else if (matches.length > 1) {
    // Prefer the native (contract-less) entry for gas tokens.
    const native = matches.filter((t) => !t.contractAddress);
    if (native.length === 1) matches = native;
  }

  if (matches.length !== 1) {
    throw new RailError(
      matches.length === 0 ? "ASSET_NOT_FOUND" : "ASSET_AMBIGUOUS",
      `could not uniquely resolve ${symbol} on ${CHAIN_LABEL[chain]} in 1Click token list (${matches.length} matches)`,
      { candidates: matches.map((m) => m.assetId) },
    );
  }
  const t = matches[0]!;
  return {
    chain,
    symbol,
    assetId: t.assetId,
    decimals: t.decimals,
    priceUsd: t.price,
    contractAddress: t.contractAddress,
    native: !pin && !t.contractAddress,
  };
}
