import { MODELS, PRIVACY_MODES } from "@pay/rail/browser";
import { brand } from "../brand.ts";

/**
 * opencode only offers the models listed in its config, so list every model a
 * coding agent can use: all non-TEE ones (TEE models can't carry tool
 * definitions through E2EE). `allowed` narrows it to a key's model allowlist.
 */
export function opencodeConfig({ baseURL, keyHint, allowed = [] }: { baseURL: string; keyHint: string; allowed?: string[] }): string {
  const id = brand.repo;
  const env = `${id.toUpperCase()}_API_KEY`;
  const models = Object.values(MODELS).filter((m) => !m.e2ee && (!allowed.length || allowed.includes(m.key)));
  const preferred = PRIVACY_MODES.anonymous.chatModel;
  const def = models.some((m) => m.key === preferred) ? preferred : (models[0]?.key ?? preferred);
  const width = Math.max(...models.map((m) => m.key.length)) + 3;
  const lines = models.map((m, i) => `        ${`"${m.key}":`.padEnd(width)} { "name": "${m.label}" }${i < models.length - 1 ? "," : ""}`);
  return `// Save as ~/.config/opencode/opencode.jsonc (or opencode.jsonc in a project).
// Then, in the same terminal: export ${env}=${keyHint}
// and start with: opencode --standalone   (the background service can't see new env vars)
{
  "$schema": "https://opencode.ai/config.json",
  "model": "${id}/${def}",
  "providers": {
    "${id}": {
      "name": "${brand.name}",
      "env": ["${env}"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "${baseURL}" },
      "models": {
${lines.join("\n")}
      }
    }
  }
}`;
}
