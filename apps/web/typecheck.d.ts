// Used only by `npm run typecheck` (tsconfig.typecheck.json): Next's ambient types plus
// route types from `next typegen`, without the dev server's .next/dev/types (which would conflict).
/// <reference types="next" />
/// <reference types="next/image-types/global" />
import "./.next/types/routes.d.ts";
