"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { SolanaAdapter } from "@reown/appkit-adapter-solana";
import { base, solana, type AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { brand } from "../brand";

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

// Funding origins we actually support end to end (see packages/rail/src/assets.ts).
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [base, solana];

export const wagmiAdapter = new WagmiAdapter({ networks, projectId, ssr: true });
const solanaAdapter = new SolanaAdapter();

let created = false;
export function initAppKit() {
  // Runs on the server too (pre-render): AppKit hooks require createAppKit first.
  if (created) return;
  created = true;
  createAppKit({
    adapters: [wagmiAdapter, solanaAdapter],
    networks,
    projectId,
    metadata: {
      name: brand.name,
      description: brand.tagline,
      url: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
      icons: [],
    },
    // Wallets only: no email/social login (that would tie an identity to the account),
    // no built-in swaps/onramp (funding goes through NEAR Intents), no analytics.
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
    themeMode: "dark",
    themeVariables: {
      "--w3m-accent": "#ece7de",
      "--w3m-color-mix": "#0c0d0f",
      "--w3m-color-mix-strength": 40,
      "--w3m-border-radius-master": "2px",
      "--w3m-font-family": "var(--font-ui), system-ui, sans-serif",
    },
  });
}
