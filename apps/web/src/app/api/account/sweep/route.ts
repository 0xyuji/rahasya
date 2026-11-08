import { json, withUser } from "../../../../server/http";
import { sweepToCredit } from "../../../../server/api-wallet";

/** Turn USDC sitting on the API wallet into Venice credit (x402 top-up signed server-side). */
export const POST = (req: Request) => withUser(req, async (uid) => json(200, await sweepToCredit(uid)));
