import type { PrivateKeyAccount } from "viem/accounts";
import { apiWalletAccount, existingApiWallet, idleUsdc, veniceForApiWallet } from "../../../server/api-wallet";
import { json, withUser } from "../../../server/http";

export const dynamic = "force-dynamic";

async function describe(uid: string, account: PrivateKeyAccount | null) {
  if (!account) return json(200, { uid, apiWallet: null, creditUsd: null, idleUsdc: null });
  const [bal, usdc] = await Promise.allSettled([veniceForApiWallet(account).balance(), idleUsdc(account.address)]);
  return json(200, {
    uid,
    apiWallet: account.address,
    creditUsd: bal.status === "fulfilled" ? bal.value.balanceUsd : null,
    idleUsdc: usdc.status === "fulfilled" ? usdc.value : null,
  });
}

/** Read-only: the signed-in user's API wallet (null if they haven't opened one), credit and idle USDC. */
export const GET = (req: Request) => withUser(req, async (uid) => describe(uid, await existingApiWallet(uid)));

/** Open (create once) the user's API wallet, then describe it. */
export const POST = (req: Request) => withUser(req, async (uid) => describe(uid, await apiWalletAccount(uid)));
