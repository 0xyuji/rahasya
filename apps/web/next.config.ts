import type { NextConfig } from "next";

const config: NextConfig = {
  // The rail ships as TypeScript source (no build step); let Next compile it.
  transpilePackages: ["@pay/rail"],
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      // wagmi's Base Account connector -> @coinbase/cdp-sdk lazily imports x402 Solana
      // helpers we never use (and don't install). Point them at an empty module.
      "@x402/svm/exact/client": "./src/stubs/empty.js",
    },
  },
};

export default config;
