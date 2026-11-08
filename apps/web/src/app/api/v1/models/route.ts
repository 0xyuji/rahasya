import { handleModels } from "../../../../server/gateway";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => handleModels(req);
