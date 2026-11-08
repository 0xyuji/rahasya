import { json, sameOrigin } from "../../../../server/http";
import { createSession, sessionCookie, verifyLogin, type LoginProof } from "../../../../server/login";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { message: "Cross-site request refused." });
  try {
    const uid = await verifyLogin((await req.json()) as LoginProof);
    const sid = await createSession(uid);
    return json(200, { uid }, { "set-cookie": sessionCookie(sid, new URL(req.url).protocol === "https:") });
  } catch (e) {
    return json(401, { message: (e as Error).message });
  }
}
