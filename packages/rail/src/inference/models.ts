/**
 * Allowed models — team policy (2026-11-07):
 *   - Venice only.
 *   - ONLY uncensored / abliterated models. No standard models, anywhere.
 *   - "Truly private" mode = TEE (e2ee-*) models only, always called with E2EE.
 *
 * `fallbackPrice` (USD per 1M tokens, 2026-11-07) is used only when the live
 * /models catalog can't be fetched; live prices win otherwise.
 */
export const TIERS = ["anonymized", "private", "tee"] as const;
export type PrivacyTier = (typeof TIERS)[number];
export const tierRank = (t: PrivacyTier) => TIERS.indexOf(t);

export interface ModelDef {
  key: string;
  id: string; // Venice model id
  label: string;
  tier: PrivacyTier;
  /** Supports response_format json_schema. */
  structuredOutputs: boolean;
  /** Must be called with client-side E2EE (all e2ee-* models). */
  e2ee: boolean;
  fallbackPrice: { in: number; out: number };
}

const m = (
  key: string,
  id: string,
  label: string,
  tier: PrivacyTier,
  structuredOutputs: boolean,
  inP: number,
  outP: number,
): ModelDef => ({ key, id, label, tier, structuredOutputs, e2ee: tier === "tee", fallbackPrice: { in: inP, out: outP } });

export const MODELS: Record<string, ModelDef> = Object.fromEntries(
  [
    // anonymized: Venice strips identity; the upstream host may see prompt text
    m("large-flash", "abliteration-abliterated-model-large-flash", "Abliterated Large Flash", "anonymized", true, 1.25, 2.5),
    m("large-v2", "abliteration-abliterated-model-large-v2", "Abliterated Large V2", "anonymized", true, 3, 5),
    m("aion-3.5", "aion-labs-aion-3-5", "Aion 3.5", "anonymized", true, 3.75, 7.5),
    m("aion-3.5-mini", "aion-labs-aion-3-5-mini", "Aion 3.5 Mini", "anonymized", true, 0.875, 1.75),
    m("aion-3.0", "aion-labs-aion-3-0", "Aion 3.0", "anonymized", true, 3.75, 7.5),
    m("aion-3.0-mini", "aion-labs-aion-3-0-mini", "Aion 3.0 Mini", "anonymized", true, 0.875, 1.75),
    m("qwen-3.6-plus", "qwen-3-6-plus", "Qwen 3.6 Plus Uncensored", "anonymized", true, 0.625, 3.75),
    // private: Venice-hosted, no retention
    m("deepseek-1017-uncensored", "deepseek-v4-1-flash-1017-uncensored", "DeepSeek V4.1 Flash 1017 Uncensored", "private", true, 0.33, 1.32),
    m("deepseek-uncensored", "deepseek-v4-1-flash-uncensored", "DeepSeek V4.1 Flash Uncensored", "private", true, 0.33, 1.32),
    m("qwen-3.8-27b", "qwen-3-8-27b", "Qwen 3.8 27B Uncensored", "private", true, 0.45, 3.2),
    m("gemma-4-uncensored", "gemma-4-uncensored", "Gemma 4 Uncensored", "private", true, 0.1625, 0.5),
    m("venice-uncensored", "venice-uncensored-1-2", "Venice Uncensored 1.2", "private", true, 0.2, 0.9),
    m("venice-roleplay", "venice-uncensored-role-play", "Venice Role Play Uncensored", "private", true, 0.5, 2),
    m("glm-4.7-heretic", "olafangensan-glm-4.7-flash-heretic", "GLM 4.7 Flash Heretic", "private", true, 0.07, 0.4),
    // tee: hardware enclave, attested, end-to-end encrypted from the browser
    m("deepseek-abliterated-tee", "e2ee-deepseek-v4-1-flash-1017-abliterated", "DeepSeek V4.1 Flash 1017 Abliterated (TEE)", "tee", false, 0.375, 1.5),
    m("gemma-4-26b-tee", "e2ee-gemma-4-26b-a4b-uncensored-p", "Gemma 4 26B A4B Uncensored (TEE)", "tee", false, 0.19, 0.88),
  ].map((d) => [d.key, d]),
);

/**
 * The toggle in the chat prompt bar.
 *  - anonymous (default): every allowed model. You're unlinkable (wallet auth,
 *    no account), but the model host may see prompt text.
 *  - private: TEE-only + E2EE. Only the attested enclave can read prompts.
 *    Fewer, smaller models -> lower intelligence.
 */
export const PRIVACY_MODES = {
  anonymous: { label: "Anonymous", minTier: "anonymized", intentModel: "large-flash", chatModel: "large-v2" },
  private: { label: "Truly private (TEE)", minTier: "tee", intentModel: "deepseek-abliterated-tee", chatModel: "deepseek-abliterated-tee" },
} as const satisfies Record<string, { label: string; minTier: PrivacyTier; intentModel: string; chatModel: string }>;

export type PrivacyMode = keyof typeof PRIVACY_MODES;

export function modelsForMode(mode: PrivacyMode): ModelDef[] {
  const min = tierRank(PRIVACY_MODES[mode].minTier);
  return Object.values(MODELS).filter((d) => tierRank(d.tier) >= min);
}

/** Resolve a model for a mode; throws instead of ever downgrading privacy. */
export function resolveModel(mode: PrivacyMode, key?: string): ModelDef {
  const k = key ?? PRIVACY_MODES[mode].chatModel;
  const d = MODELS[k];
  if (!d) throw new Error(`model "${k}" is not in the allowed list`);
  if (tierRank(d.tier) < tierRank(PRIVACY_MODES[mode].minTier)) {
    throw new Error(`${d.label} is not allowed in ${PRIVACY_MODES[mode].label} mode`);
  }
  return d;
}

export type LivePrices = Map<string, { in: number; out: number }>; // keyed by Venice model id

export function parseVenicePrices(
  data: Array<{ id: string; model_spec?: { pricing?: { input?: { usd?: number }; output?: { usd?: number } } } }>,
): LivePrices {
  const map: LivePrices = new Map();
  for (const d of data) {
    const i = d.model_spec?.pricing?.input?.usd;
    const o = d.model_spec?.pricing?.output?.usd;
    if (typeof i === "number" && typeof o === "number") map.set(d.id, { in: i, out: o });
  }
  return map;
}

export function priceOf(d: ModelDef, live?: LivePrices) {
  return live?.get(d.id) ?? d.fallbackPrice;
}

export function costUsd(d: ModelDef, usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, live?: LivePrices) {
  if (usage?.prompt_tokens === undefined || usage?.completion_tokens === undefined) return undefined;
  const p = priceOf(d, live);
  return (usage.prompt_tokens * p.in + usage.completion_tokens * p.out) / 1e6;
}
