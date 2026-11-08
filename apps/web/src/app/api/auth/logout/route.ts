import { json, sameOrigin } from "../../../../server/http";
import { endSession } from "../../../../server/login";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { message: "Cross-site request refused." });
  await endSession(req);
  return json(200, { ok: true }, { "set-cookie": "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
}
