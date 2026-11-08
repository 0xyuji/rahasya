/**
 * Brand is hot-swappable: every user-visible name, tagline and URL comes from here.
 * Switch with NEXT_PUBLIC_BRAND=<key> (build-time env on Vercel / Cloudflare), no code edits.
 * Rule: the name never appears without its tagline.
 */
export interface Brand {
  key: string;
  name: string;
  /** Always shown next to the name. Keep "Private AI" (privacy-track wording). */
  tagline: string;
  /** One-line meaning of the name, for the README / about text. */
  meaning: string;
  /** Domain (rahasya.chat is registered; the others are only planned). */
  domain: string;
  repo: string;
}

const BRANDS: Record<string, Brand> = {
  naisho: {
    key: "naisho",
    name: "Naisho",
    tagline: "Private AI, just between us",
    meaning: "Japanese 内緒 (naisho): a secret kept just between us.",
    domain: "naisho.chat",
    repo: "naisho",
  },
  rahasya: {
    key: "rahasya",
    name: "Rahasya",
    tagline: "Private AI, kept in confidence",
    meaning: "Sanskrit/Hindi रहस्य (rahasya): a secret, a hidden truth.",
    domain: "rahasya.chat",
    repo: "rahasya",
  },
  sotto: {
    key: "sotto",
    name: "Sotto",
    tagline: "Private AI, under your breath",
    meaning: "Italian sotto voce: in a low voice, under one's breath.",
    domain: "sottovoce.chat",
    repo: "sotto",
  },
};

const DEFAULT_BRAND = "rahasya";

export const brand: Brand = BRANDS[process.env.NEXT_PUBLIC_BRAND ?? DEFAULT_BRAND] ?? BRANDS[DEFAULT_BRAND]!;
