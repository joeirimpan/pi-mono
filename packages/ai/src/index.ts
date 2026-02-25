export type { Static, TSchema } from "@sinclair/typebox";
export { Type } from "@sinclair/typebox";

export * from "./api-registry.js";
export * from "./env-api-keys.js";
export * from "./models.js";
export * from "./providers/anthropic.js";
export * from "./providers/azure-openai-responses.js";
// Google providers are NOT re-exported here to avoid eagerly loading @google/genai
// and google-auth-library (~60ms). They are lazy-loaded via registerLazyApiProvider
// in register-builtins.ts. Import directly from the provider files if needed.
export * from "./providers/openai-completions.js";
export * from "./providers/openai-responses.js";
export * from "./providers/register-builtins.js";
export * from "./stream.js";
export * from "./types.js";
export * from "./utils/event-stream.js";
export * from "./utils/json-parse.js";
export * from "./utils/oauth/index.js";
export * from "./utils/overflow.js";
export * from "./utils/typebox-helpers.js";
export * from "./utils/validation.js";
