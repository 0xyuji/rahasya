import { json, withUser } from "../../../../server/http";
import { deleteKey, updateKey } from "../../../../server/keys";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = (req: Request, ctx: Ctx) =>
  withUser(req, async (uid) => {
    await updateKey(uid, (await ctx.params).id, await req.json());
    return json(200, { ok: true });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  withUser(req, async (uid) => {
    await deleteKey(uid, (await ctx.params).id);
    return json(200, { ok: true });
  });
