import { fromOurPage, json } from "../../../../server/http";
import { clearSessionCookie, endSession } from "../../../../server/login";

/** POST /api/auth/logout ends this session; ?everywhere=1 ends all of this wallet's sessions. */
export async function POST(req: Request) {
  if (!fromOurPage(req)) return json(403, { message: "Cross-site request refused." });
  const url = new URL(req.url);
  await endSession(req, url.searchParams.get("everywhere") === "1");
  return json(200, { ok: true }, { "set-cookie": clearSessionCookie(url.protocol === "https:") });
}
