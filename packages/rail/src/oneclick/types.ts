// Types mirror https://1click.chaindefuser.com/docs/v0/openapi.yaml (checked 2026-11-07).
// Only the fields we use are typed; unknown extras pass through untouched.

export type OneClickChain = "near" | "eth" | "base" | "arb" | "btc" | "sol" | "zec" | (string & {});

export interface TokenResponse {
  assetId: string;
  decimals: number;
  blockchain: OneClickChain;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
  coingeckoId?: string;
}

export type SwapType = "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT" | "ANY_INPUT";
export type DepositType = "ORIGIN_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";
export type RecipientType = "DESTINATION_CHAIN" | "INTENTS" | "CONFIDENTIAL_INTENTS";

export interface QuoteRequest {
  dry: boolean;
  swapType: SwapType;
  slippageTolerance: number; // bps
  originAsset: string;
  depositType: DepositType;
  destinationAsset: string;
  amount: string; // smallest units; input or output depending on swapType
  refundTo: string;
  refundType: DepositType;
  recipient: string;
  recipientType: RecipientType;
  deadline: string; // ISO
  depositMode?: "SIMPLE" | "MEMO";
  quoteWaitingTimeMs?: number;
  appFees?: Array<{ recipient: string; fee: number }>;
  referral?: string;
  confidentiality?: "public" | "basic" | "advanced";
  sessionId?: string;
}

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number; // seconds after deposit confirmed
  refundFee?: string;
  withdrawFee?: string;
}

export interface QuoteResponse {
  correlationId: string;
  timestamp: string;
  /** 1Click's signature over the quote. Keep it — it's your receipt for disputes. */
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Quote;
}

export type ExecutionStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export interface TransactionDetails {
  hash: string;
  explorerUrl: string;
}

export interface SwapDetails {
  intentHashes: string[];
  nearTxHashes: string[];
  originChainTxHashes: TransactionDetails[];
  destinationChainTxHashes: TransactionDetails[];
  amountIn?: string;
  amountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  amountOutUsd?: string;
  slippage?: number;
  refundedAmount?: string;
  refundedAmountFormatted?: string;
  refundReason?: string;
  depositedAmount?: string;
  depositedAmountFormatted?: string;
}

export interface StatusResponse {
  correlationId: string;
  quoteResponse: QuoteResponse;
  status: ExecutionStatus;
  updatedAt: string;
  swapDetails: SwapDetails;
}
