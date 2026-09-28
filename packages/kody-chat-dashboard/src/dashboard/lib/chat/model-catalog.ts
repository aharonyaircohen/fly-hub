import type { ChatModel } from "@kody-ade/base/variables/models";
import { PROVIDER_PRESETS } from "@kody-ade/base/variables/models";

export const OPENCODE_FREE_MODEL_ID = "opencode-free";
export const OPENCODE_FREE_PICKER_MODEL = Object.freeze({
  id: OPENCODE_FREE_MODEL_ID,
  label: "OpenCode Free",
  enabled: true,
  default: false,
  automatic: false,
});

export function openCodeChatModels(
  entries: readonly {
    id: string;
    label: string;
    adapter: "openai-compatible" | "openai-responses";
  }[],
): ChatModel[] {
  return entries.map((entry) => ({
    id: `opencode-free/${entry.id}`,
    label: entry.label,
    provider: "opencode-free",
    protocol: "openai",
    baseURL: PROVIDER_PRESETS["opencode-free"].baseURL,
    adapterBaseURL: PROVIDER_PRESETS["opencode-free"].adapterBaseURL,
    adapter: entry.adapter,
    modelName: entry.id,
    apiKeySecret: "",
    enabled: true,
    default: false,
    automatic: false,
    engineDefault: false,
  }));
}

/**
 * @fileType utility
 * @domain chat
 * @pattern model-catalog
 * @ai-summary Kody product model policy, kept out of the public embeddable
 *   chat package.
 */

export const KODY_OPENROUTER_FREE_CHAT_MODEL = Object.freeze({
  id: "openrouter/free",
  label: "OpenRouter Free",
  provider: "openrouter",
  protocol: "openai",
  baseURL: "https://openrouter.ai/api/v1",
  modelName: "openrouter/free",
  apiKeySecret: "OPENROUTER_API_KEY",
  enabled: true,
  default: true,
  engineDefault: false,
} as const satisfies ChatModel);

export const KODY_XKIRO_FREE_CHAT_MODEL = Object.freeze({
  id: "xkiro/deepseek/deepseek-v4-flash",
  label: "xKiro Free",
  provider: "xkiro",
  protocol: "openai",
  baseURL: "https://api.xkiro.com/v1",
  modelName: "deepseek/deepseek-v4-flash",
  apiKeySecret: "XKIRO_API_KEY",
  enabled: true,
  default: false,
  engineDefault: false,
} as const satisfies ChatModel);

export const KODY_OX_ALPHA_CHAT_MODEL = Object.freeze({
  id: "openai/ox-alpha",
  label: "Ox Alpha",
  provider: "custom",
  adapter: "openai-compatible",
  adapterBaseURL: "https://oxalpha.run/api/v1",
  protocol: "openai",
  baseURL: "https://oxalpha.run/api/v1",
  modelName: "ox-alpha",
  apiKeySecret: "OXALPHA_API_KEY",
  enabled: true,
  default: false,
  engineDefault: false,
} as const satisfies ChatModel);

export const KODY_BUILT_IN_CHAT_MODELS = Object.freeze([
  KODY_OPENROUTER_FREE_CHAT_MODEL,
  KODY_XKIRO_FREE_CHAT_MODEL,
  KODY_OX_ALPHA_CHAT_MODEL,
]);

export function isBuiltInChatModelId(id: string): boolean {
  return KODY_BUILT_IN_CHAT_MODELS.some((model) => model.id === id);
}

export interface CatalogModel {
  id: string;
  enabled?: boolean;
  default?: boolean;
}

export function composeChatModelCatalog<T extends CatalogModel>(
  configuredModels: readonly T[],
  builtInModels: T | readonly T[],
): T[] {
  const configured = [...configuredModels];
  const builtIns = Array.isArray(builtInModels)
    ? builtInModels
    : [builtInModels];
  const hasExplicitDefault = configured.some(
    (model) => model.enabled !== false && model.default === true,
  );
  const hasConfiguredBuiltIn = configured.some((model) =>
    builtIns.some((builtIn) => builtIn.id === model.id),
  );
  const missingBuiltIns = builtIns.filter(
    (builtIn) => !configured.some((model) => model.id === builtIn.id),
  );
  if (missingBuiltIns.length === 0) return configured;

  return [
    ...missingBuiltIns.map(
      (builtIn, index) =>
        ({
          ...builtIn,
          default: !hasExplicitDefault && !hasConfiguredBuiltIn && index === 0,
        }) as T,
    ),
    ...configured,
  ];
}
