"use client";

import { useWallet } from "../wallet/wallet-context";
import { Mascot } from "./mascot";

/** The header's mascot: it wakes when you hover the name, and stays awake once your inference wallet is unlocked. */
export function HeaderMark({ className }: { className?: string }) {
  const w = useWallet();
  return <Mascot className={className} awake={!!w.inference} wakeOnHover />;
}
