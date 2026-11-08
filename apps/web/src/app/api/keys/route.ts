import { json, withUser } from "../../../server/http";
import { createKey, listKeys } from "../../../server/keys";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => withUser(req, async (uid) => json(200, { keys: await listKeys(uid) }));
/** Returns the token exactly once. */
export const POST = (req: Request) => withUser(req, async (uid) => json(201, await createKey(uid, await req.json())));
