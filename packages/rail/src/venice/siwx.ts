import type { LocalAccount } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";

/**
 * Venice SIGN-IN-WITH-X header (per docs.venice.ai x402 guide):
 * base64(JSON({ ...siweFields, chainId: "eip155:8453", type: "eip191", signature }))
 * where the signed EIP-4361 message uses numeric chainId 8453.
 *
 * Each header is SINGLE-USE and valid 5 minutes: build a fresh one per request.
 */
export async function createSiwxHeader(
  account: Pick<LocalAccount, "address" | "signMessage">,
  resourceUrl: string,
  now: Date = new Date(),
): Promise<string> {
  const fields = {
    domain: "api.venice.ai",
    address: account.address,
    statement: "Sign in to Venice AI",
    uri: resourceUrl,
    version: "1" as const,
    nonce: generateSiweNonce(),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const message = createSiweMessage({
    ...fields,
    chainId: 8453,
    issuedAt: now,
    expirationTime: new Date(fields.expirationTime),
  });
  const signature = await account.signMessage({ message });
  const payload = { ...fields, chainId: "eip155:8453", type: "eip191", signature };
  return base64Utf8(JSON.stringify(payload));
}

/** UTF-8 -> base64 without Node's Buffer, so this runs in the browser too. */
function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
