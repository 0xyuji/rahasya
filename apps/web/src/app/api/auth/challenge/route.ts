import { json, sameOrigin } from "../../../../server/http";
import { createChallenge, type Chain } from "../../../../server/login";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json(403, { message: "Cross-site request refused." });
  const { chain, address } = (await req.json().catch(() => ({}))) as { chain?: Chain; address?: string };
  if (!chain || !["evm", "sol", "near"].includes(chain) || typeof address !== "string" || !address || address.length > 100) {
    return json(400, { message: "chain and address are required." });
  }
  return json(200, await createChallenge(new URL(req.url).origin, chain, address));
}
