import type { NextConfig } from "next";

/**
 * Security headers. The big one for a site where people sign messages is
 * anti-framing (no clickjacking of the wallet prompts). A strict default-src
 * CSP is intentionally not set: the Reown/WalletConnect modal loads from many
 * origins and would break.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't tell Venice, RPCs or explorers which page you came from.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  // The rail ships as TypeScript source (no build step); let Next compile it.
  transpilePackages: ["@pay/rail"],
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    resolveAlias: {
      // wagmi's Base Account connector -> @coinbase/cdp-sdk lazily imports x402 Solana
      // helpers we never use (and don't install). Point them at an empty module.
      "@x402/svm/exact/client": "./src/stubs/empty.js",
    },
  },
};

export default config;
