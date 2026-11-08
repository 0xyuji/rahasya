import { apiWalletAccount, idleUsdc, veniceForApiWallet } from "../../../server/api-wallet";
import { json, withUser } from "../../../server/http";

export const dynamic = "force-dynamic";

/** The signed-in user's API wallet: address, Venice credit, idle USDC waiting to be credited. */
export const GET = (req: Request) =>
  withUser(req, async (uid) => {
    const account = await apiWalletAccount(uid);
    const [bal, usdc] = await Promise.allSettled([veniceForApiWallet(account).balance(), idleUsdc(account.address)]);
    return json(200, {
      uid,
      apiWallet: account.address,
      creditUsd: bal.status === "fulfilled" ? bal.value.balanceUsd : null,
      idleUsdc: usdc.status === "fulfilled" ? usdc.value : null,
    });
  });
