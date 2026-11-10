import { defineMachine } from "@pay/rail/browser";

/**
 * The two funding flows as data: the transition tables `move()` enforces, and
 * what each state shows in the progress list. See docs/state-machines.md.
 * State names are saved in users' browsers, so never rename one.
 */
export type CreditState =
  | "QUOTED"
  | "SENDING"
  | "SEND_UNCONFIRMED"
  | "DEPOSIT_SENT"
  | "SWAPPING"
  | "SWAPPED"
  | "TOPPING_UP"
  | "DONE"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED"
  | "DISMISSED";

export const CREDIT_MACHINE = defineMachine<CreditState>("credit", {
  QUOTED: ["SENDING", "SWAPPING", "SEND_UNCONFIRMED", "EXPIRED", "FAILED"],
  SENDING: ["DEPOSIT_SENT", "QUOTED", "SWAPPING", "SEND_UNCONFIRMED"],
  SEND_UNCONFIRMED: ["SWAPPING", "QUOTED", "DISMISSED"],
  DEPOSIT_SENT: ["SWAPPING", "SWAPPED", "REFUNDED", "FAILED", "SEND_UNCONFIRMED", "DISMISSED"],
  SWAPPING: ["SWAPPING", "SWAPPED", "REFUNDED", "FAILED", "SEND_UNCONFIRMED", "DISMISSED"],
  SWAPPED: ["TOPPING_UP"],
  TOPPING_UP: ["DONE", "DISMISSED"],
  DONE: [],
  REFUNDED: [],
  FAILED: [],
  EXPIRED: [],
  DISMISSED: [],
});

export const CREDIT_FINAL: ReadonlySet<CreditState> = CREDIT_MACHINE.final;

export type AnywhereState =
  | "AWAITING_DEPOSIT"
  | "INCOMPLETE"
  | "RECEIVED"
  | "SWAPPED"
  | "TOPPING_UP"
  | "DONE"
  | "IDLE"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export const ANYWHERE_MACHINE = defineMachine<AnywhereState>("anywhere", {
  AWAITING_DEPOSIT: ["INCOMPLETE", "RECEIVED", "SWAPPED", "REFUNDED", "FAILED", "EXPIRED", "CANCELLED"],
  INCOMPLETE: ["INCOMPLETE", "RECEIVED", "SWAPPED", "REFUNDED", "FAILED"],
  RECEIVED: ["RECEIVED", "INCOMPLETE", "SWAPPED", "REFUNDED", "FAILED"],
  SWAPPED: ["TOPPING_UP", "IDLE"],
  TOPPING_UP: ["TOPPING_UP", "IDLE", "DONE"],
  DONE: [],
  IDLE: [],
  REFUNDED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
});

export const ANYWHERE_FINAL: ReadonlySet<AnywhereState> = ANYWHERE_MACHINE.final;

/** The wallet broadcast the deposit, then confirming it failed. Funds may have moved, so this is never "nothing was sent". */
export class DepositBroadcastError extends Error {
  readonly txHash: string;
  constructor(txHash: string, cause: unknown) {
    super("The deposit was sent, but we couldn't confirm it.", { cause });
    this.txHash = txHash;
  }
}

/** Provably nothing left the wallet: the prompt never opened, or the transaction reverted. Safe to offer the send again. */
export class DepositNotSentError extends Error {}

export type StepStatus = "todo" | "now" | "done" | "fail";
/** Send or receive the deposit, swap, add credit. */
export type StepRow = readonly [StepStatus, StepStatus, StepStatus];

const CREDIT_STEPS: Record<CreditState, StepRow> = {
  QUOTED: ["todo", "todo", "todo"],
  SENDING: ["now", "todo", "todo"],
  SEND_UNCONFIRMED: ["now", "todo", "todo"],
  DEPOSIT_SENT: ["done", "now", "todo"],
  SWAPPING: ["done", "now", "todo"],
  SWAPPED: ["done", "done", "now"],
  TOPPING_UP: ["done", "done", "now"],
  DONE: ["done", "done", "done"],
  REFUNDED: ["done", "fail", "todo"],
  FAILED: ["done", "fail", "todo"],
  EXPIRED: ["todo", "todo", "todo"],
  DISMISSED: ["todo", "todo", "todo"],
};

export function creditSteps(a: { state: CreditState; depositTx?: string; oneclickStatus?: string }): StepRow {
  // Refused before anything was sent: the send failed, not the swap.
  if (a.state === "FAILED" && !a.depositTx && !a.oneclickStatus) return ["fail", "todo", "todo"];
  return CREDIT_STEPS[a.state];
}

/** null: no deposit was received, so there's no progress to show. */
const ANYWHERE_STEPS: Record<AnywhereState, StepRow | null> = {
  AWAITING_DEPOSIT: null,
  INCOMPLETE: null,
  RECEIVED: ["done", "now", "todo"],
  SWAPPED: ["done", "done", "now"],
  TOPPING_UP: ["done", "done", "now"],
  DONE: ["done", "done", "done"],
  IDLE: ["done", "done", "todo"],
  REFUNDED: ["done", "fail", "todo"],
  FAILED: ["done", "fail", "todo"],
  EXPIRED: null,
  CANCELLED: null,
};

export const anywhereSteps = (state: AnywhereState): StepRow | null => ANYWHERE_STEPS[state];
