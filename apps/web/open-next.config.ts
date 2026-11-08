import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// The site has no revalidation (docs are static, everything else is dynamic or client-side),
// so prerendered pages can be served straight from the static assets: no R2 or KV needed.
export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache });
