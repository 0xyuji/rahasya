import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { brand } from "../brand";

const display = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-display", display: "swap" });
const ui = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-ui", display: "swap" });

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: `${brand.name} is private AI paid in any token: uncensored and abliterated models, funded through NEAR Intents from any chain, no account. Optional Truly private mode runs only on attested TEEs with end-to-end encryption.`,
};

export const viewport: Viewport = { themeColor: "#0c0d0f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
