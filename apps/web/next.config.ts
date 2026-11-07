import type { NextConfig } from "next";

const config: NextConfig = {
  // The rail ships as TypeScript source (no build step); let Next compile it.
  transpilePackages: ["@pay/rail"],
  reactStrictMode: true,
};

export default config;
