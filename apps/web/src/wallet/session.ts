import { ed25519 } from "@noble/curves/ed25519.js";
import { recoverMessageAddress, type Hex } from "viem";

/** Which address signed the message? A smart account can legitimately sign with an owner key, so callers ask rather than refuse; a wallet signing with the wrong account would create a wallet the user can't get back to. */
export async function recoverSigner(message: string, signature: Hex): Promise<string | null> {
  try {
    return (await recoverMessageAddress({ message, signature })).toLowerCase();
  } catch {
    return null; // an unusual encoding says nothing about who signed
  }
}

/** False for a wrong signer, and also for a Ledger, which signs a different message format (so callers ask rather than refuse). */
export function solanaSignatureValid(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

/** Where the user is in the wallet lifecycle. Everything else (buttons, labels) follows from this. */
export type WalletSession = "disconnected" | "locked" | "unlocking" | "unlocked";

export function walletSession(connected: boolean, unlocked: boolean, unlocking: boolean): WalletSession {
  if (!connected) return "disconnected";
  if (unlocked) return "unlocked";
  return unlocking ? "unlocking" : "locked";
}

/** The server's user id for a wallet (same rule as `userId` in server/login.ts). */
export function walletUid(source: { chain: string; address: string }): string {
  return `${source.chain}:${source.chain === "evm" ? source.address.toLowerCase() : source.address}`;
}

/**
 * Tracks the one unlock in progress. A second `begin` while one is running is
 * refused (no second wallet prompt). `cancel` disowns the running attempt, so a
 * prompt left open on a previous wallet can't keep the new one from unlocking.
 */
export function attemptGuard() {
  let current: object | null = null;
  let epoch = 0;
  const startedIn = new WeakMap<object, number>();
  return {
    /** The user locked or gave up: any signature still on its way, from any attempt, is thrown away. */
    abandon() {
      epoch++;
      current = null;
    },
    wasAbandoned: (attempt: object) => startedIn.get(attempt) !== epoch,
    begin(): object | null {
      if (current) return null;
      current = {};
      startedIn.set(current, epoch);
      return current;
    },
    isCurrent: (attempt: object) => attempt === current,
    cancel() {
      current = null;
    },
  };
}
