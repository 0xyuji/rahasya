import { handleChat } from "../../../../../server/gateway";

export const dynamic = "force-dynamic";
// Long generations stream for a while; allow it (capped by the hosting plan).
export const maxDuration = 300;
export const POST = (req: Request) => handleChat(req);
