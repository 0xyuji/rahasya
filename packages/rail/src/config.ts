import { z } from "zod";

/**
 * All runtime configuration, validated once at startup. Fails loudly on bad
 * values rather than discovering them mid-swap.
 *
 * Keys here must be BURNER wallets only. Never put a treasury key in .env.
 */
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected 0x-prefixed 32-byte hex private key");

const ConfigSchema = z.object({
  // --- wallets ---
  BASE_PRIVATE_KEY: hex32,
  /** Solana secret key: base58 (Phantom export) or JSON byte array (solana-keygen). */
  SOLANA_SECRET_KEY: z.string().min(32).optional(),

  // --- RPCs (point these at your VPN'd / private RPCs for the privacy story) ---
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),

  // --- NEAR Intents 1Click ---
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  /** API key / JWT from partners.near-intents.org. Optional, but without it 1Click charges an extra fee. */
  ONECLICK_API_KEY: z.string().optional(),
  /** Slippage in basis points. 100 = 1%. */
  SWAP_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(500).default(100),
  /** Integrator fee in bps taken on swaps (needs ONECLICK_FEE_RECIPIENT). 0 = off. */
  ONECLICK_APP_FEE_BPS: z.coerce.number().int().min(0).max(300).default(0),
  ONECLICK_FEE_RECIPIENT: z.string().optional(),

  // --- Venice ---
  VENICE_BASE_URL: z.string().url().default("https://api.venice.ai/api/v1"),
  /** Default model for intent parsing. Must support response_format json_schema. */
  VENICE_MODEL: z.string().default("qwen3-235b-a22b-instruct-2507"),

  // --- float / refill policy ---
  /** Refill when Venice balance drops below this (USD). */
  VENICE_MIN_BALANCE_USD: z.coerce.number().positive().default(1),
  /** Top-up amount when refilling (USD). Venice minimum is ~$5. */
  VENICE_TOPUP_USD: z.coerce.number().positive().default(5),

  // --- safety ---
  /** Hard cap on any single swap's input value (USD). */
  MAX_SWAP_USD: z.coerce.number().positive().default(25),
  /** Hard cap on any single Venice top-up (USD). */
  MAX_TOPUP_USD: z.coerce.number().positive().default(10),
  /** Set to 1 to refuse every money-moving action (kill switch). */
  KILL_SWITCH: z.enum(["0", "1"]).default("0"),

  DATA_DIR: z.string().default("./data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.ONECLICK_APP_FEE_BPS > 0 && !cfg.ONECLICK_FEE_RECIPIENT) {
    throw new Error("ONECLICK_APP_FEE_BPS > 0 requires ONECLICK_FEE_RECIPIENT");
  }
  if (cfg.VENICE_TOPUP_USD > cfg.MAX_TOPUP_USD) {
    throw new Error("VENICE_TOPUP_USD exceeds MAX_TOPUP_USD");
  }
  return cfg;
}
