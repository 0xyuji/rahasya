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
  const abandoned = new WeakSet<object>();
  return {
    /** The user gave up on this prompt: a signature that still arrives later is thrown away. */
    abandon() {
      if (current) abandoned.add(current);
      current = null;
    },
    wasAbandoned: (attempt: object) => abandoned.has(attempt),
    begin(): object | null {
      if (current) return null;
      current = {};
      return current;
    },
    isCurrent: (attempt: object) => attempt === current,
    cancel() {
      current = null;
    },
  };
}
