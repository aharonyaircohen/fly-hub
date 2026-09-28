/**
 * @fileType utility
 * @domain variables
 * @pattern model-list
 * @ai-summary Typed accessor for the LLM_MODELS variable. Each entry binds
 *   a model to its own API key + endpoint. The saved adapter selects a
 *   provider adapter; model names remain configuration data and never select
 *   runtime code.
 */

import { z } from "zod";

export const VAR_LLM_MODELS = "LLM_MODELS";
export const VAR_LLM_AUTOMATIC = "LLM_AUTOMATIC";
export const AUTOMATIC_MODEL_ID = "automatic";

export type ChatModelScope = "personal" | "repo";
const CHAT_MODEL_SCOPE_SEPARATOR = "::";

export function scopedChatModelId(
  scope: ChatModelScope,
  storedId: string,
): string {
  return `${scope}${CHAT_MODEL_SCOPE_SEPARATOR}${storedId}`;
}

export function chatModelScopeFromId(id: string): ChatModelScope | null {
  if (id.startsWith(`personal${CHAT_MODEL_SCOPE_SEPARATOR}`)) return "personal";
  if (id.startsWith(`repo${CHAT_MODEL_SCOPE_SEPARATOR}`)) return "repo";
  return null;
}

export function storedChatModelId(id: string): string {
  const scope = chatModelScopeFromId(id);
  return scope
    ? id.slice(scope.length + CHAT_MODEL_SCOPE_SEPARATOR.length)
    : id;
}

export const AutomaticModelSchema = z.object({
  /** New chats select the ordered enabled-model list by default. */
  default: z.boolean().optional().default(false),
  /** Engine uses the ordered enabled-model list instead of one fixed model. */
  engineDefault: z.boolean().optional().default(false),
});
export type AutomaticModel = z.infer<typeof AutomaticModelSchema>;

/**
 * Built-in provider presets. The UI uses these to auto-fill `baseURL` and
 * `protocol`. `custom` lets the user point at any endpoint (self-hosted
 * LiteLLM proxy, in-house service, etc).
 */
export const PROVIDER_PRESETS = {
  "opencode-free": {
    label: "OpenCode Zen (free)",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://opencode.ai/zen/v1",
    protocol: "openai" as const,
    baseURL: "https://opencode.ai/zen/v1",
    keyHint: "",
  },
  anthropic: {
    label: "Anthropic (Claude)",
    adapter: "anthropic" as const,
    adapterBaseURL: "https://api.anthropic.com/v1",
    protocol: "anthropic" as const,
    baseURL: "https://api.anthropic.com/v1",
    keyHint: "ANTHROPIC_API_KEY",
  },
  google: {
    label: "Google (Gemini)",
    adapter: "google" as const,
    adapterBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "openai" as const,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyHint: "GEMINI_API_KEY",
  },
  openai: {
    label: "OpenAI",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.openai.com/v1",
    protocol: "openai" as const,
    baseURL: "https://api.openai.com/v1",
    keyHint: "OPENAI_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://openrouter.ai/api/v1",
    protocol: "openai" as const,
    baseURL: "https://openrouter.ai/api/v1",
    keyHint: "OPENROUTER_API_KEY",
  },
  xkiro: {
    label: "xKiro",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.xkiro.com/v1",
    protocol: "openai" as const,
    baseURL: "https://api.xkiro.com/v1",
    keyHint: "XKIRO_API_KEY",
  },
  groq: {
    label: "Groq",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.groq.com/openai/v1",
    protocol: "openai" as const,
    baseURL: "https://api.groq.com/openai/v1",
    keyHint: "GROQ_API_KEY",
  },
  mistral: {
    label: "Mistral",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.mistral.ai/v1",
    protocol: "openai" as const,
    baseURL: "https://api.mistral.ai/v1",
    keyHint: "MISTRAL_API_KEY",
  },
  deepseek: {
    label: "DeepSeek",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.deepseek.com/v1",
    protocol: "openai" as const,
    baseURL: "https://api.deepseek.com/v1",
    keyHint: "DEEPSEEK_API_KEY",
  },
  xai: {
    label: "xAI (Grok)",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.x.ai/v1",
    protocol: "openai" as const,
    baseURL: "https://api.x.ai/v1",
    keyHint: "XAI_API_KEY",
  },
  minimax: {
    label: "MiniMax",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "https://api.minimax.io/v1",
    protocol: "openai" as const,
    baseURL: "https://api.minimax.io/v1",
    keyHint: "MINIMAX_API_KEY",
  },
  custom: {
    label: "Custom endpoint",
    adapter: "openai-compatible" as const,
    adapterBaseURL: "",
    protocol: "openai" as const,
    baseURL: "",
    keyHint: "API_KEY",
  },
} as const;

export type ProviderPreset = keyof typeof PROVIDER_PRESETS;
export const PROVIDER_PRESET_IDS = Object.keys(
  PROVIDER_PRESETS,
) as ProviderPreset[];

export const ChatProtocolSchema = z.enum(["anthropic", "openai"]);
export type ChatProtocol = z.infer<typeof ChatProtocolSchema>;
export const ChatAdapterSchema = z.enum([
  "anthropic",
  "google",
  "openai-compatible",
  "openai-responses",
]);
export type ChatAdapter = z.infer<typeof ChatAdapterSchema>;

export const ChatToolChoiceCapabilitiesSchema = z.object({
  required: z.boolean().optional().default(false),
  named: z.boolean().optional().default(false),
});
export type ChatToolChoiceCapabilities = z.infer<
  typeof ChatToolChoiceCapabilitiesSchema
>;

const ChatModelConfigSchema = z.object({
  /** Stable id, also the React key. Free-form; the UI defaults to
   * `<provider>/<modelName>` but the user can change it. */
  id: z.string().min(1).max(160),
  /** Human label for the dropdown. */
  label: z.string().min(1).max(80),
  /** Which preset this entry was created from. Drives UI defaults. */
  provider: z.enum(
    PROVIDER_PRESET_IDS as [ProviderPreset, ...ProviderPreset[]],
  ),
  /** Dashboard chat adapter. Independent from the engine wire protocol. */
  adapter: ChatAdapterSchema.optional(),
  /** Optional endpoint override for the Dashboard chat adapter. */
  adapterBaseURL: z.string().max(512).optional(),
  /** Engine wire protocol. Dashboard chat uses `adapter` independently. */
  protocol: ChatProtocolSchema,
  /** Engine endpoint base URL (without trailing slash). */
  baseURL: z.string().max(512).default(""),
  /** Model id exactly as the provider expects it on the wire. */
  modelName: z.string().min(1).max(160),
  /** Name of the secret in /secrets to read at request time. */
  apiKeySecret: z.string().max(128),
  /** Hide from dropdown without deleting. */
  enabled: z.boolean().optional().default(true),
  /** Include this model in the ordered Automatic fallback queue. */
  automatic: z.boolean().optional(),
  /** Marks this entry as the default selection when chat opens. At most
   * one. Beats Brain auto-default. */
  default: z.boolean().optional(),
  /** Marks this entry as the model the engine runs (kody.yml / Kody Live,
   * issue + PR runs). Written to `agent.model` in the consumer repo's
   * kody.config.json. At most one. When unset, the engine falls back to
   * the chat default. Independent from `default` so chat and engine can
   * run different models. */
  engineDefault: z.boolean().optional(),
  /** Override the chat route's per-turn tool-round cap. Unset → use the
   * route default (10). Set higher to
   * let a model run a longer research chain; the function-level
   * `maxDuration` (300s) still bounds wall-clock time regardless. */
  maxSteps: z.number().int().min(1).max(500).optional(),
  /**
   * Optional wire capabilities declared by model metadata. Unknown
   * capabilities stay false so the chat route validates actual structured
   * output instead of guessing from a provider or model name.
   */
  toolChoice: ChatToolChoiceCapabilitiesSchema.optional(),
  /** Optional lifecycle commands for a model server on an existing Kody machine. */
  service: z
    .object({
      machine: z.enum(["local", "brain"]),
      startCommand: z.string().trim().min(1).max(20_000),
      stopCommand: z.string().trim().min(1).max(20_000),
    })
    .optional(),
  /**
   * Optional override of the auto-detected thinking config. Most users
   * never set this — the chat route's `defaultReasoningForModel`
   * infers a sensible `efforts` list + wire format from `modelName`
   * (Claude, GPT-5, o1, Gemini 2.5/3, Grok 4, DeepSeek R1, Magistral).
   * Set this to (a) override the detected efforts list, (b) change the
   * wire format for a non-standard endpoint, or (c) force a model that
   * has no auto-detected config into the dropdown. The chat UI uses it
   * to decide whether to render the `🧠` dropdown; the route uses
   * `applyReasoning()` to translate the chosen effort into the
   * provider's wire shape at request time.
   */
  reasoning: z
    .object({
      efforts: z
        .array(
          z.object({
            value: z.string().min(1).max(40),
            label: z.string().min(1).max(40),
          }),
        )
        .min(1)
        .max(8),
      default: z.string().min(1).max(40),
      wire: z.enum([
        "anthropic_budget",
        "openai_effort",
        "openai_extra_body",
        "gemini_budget",
        "gemini_level",
        "xai_effort",
      ]),
    })
    .optional(),
});

/**
 * Existing Google entries used the provider's OpenAI-compatible endpoint.
 * Move those records to Google's native adapter while loading them so saved
 * client configuration starts preserving Google-only tool metadata without a
 * manual migration.
 */
type ChatModelConfig = z.infer<typeof ChatModelConfigSchema>;

export const ChatModelSchema = ChatModelConfigSchema.superRefine(
  (model, ctx) => {
    if (model.provider !== "opencode-free" && !model.apiKeySecret.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["apiKeySecret"],
        message: "API key secret is required",
      });
    }
    if (
      model.provider === "opencode-free" &&
      (model.apiKeySecret !== "" ||
        model.engineDefault === true ||
        model.baseURL !== PROVIDER_PRESETS["opencode-free"].baseURL ||
        (model.adapterBaseURL !== undefined &&
          model.adapterBaseURL !==
            PROVIDER_PRESETS["opencode-free"].adapterBaseURL))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "OpenCode Free uses its fixed anonymous chat endpoint and cannot be an engine default",
      });
    }
  },
).transform((model): ChatModelConfig => {
  const preset = PROVIDER_PRESETS[model.provider];
  return {
    ...model,
    adapter: model.adapter ?? preset.adapter,
    adapterBaseURL: model.adapterBaseURL ?? preset.adapterBaseURL,
  };
});

export const ChatModelsSchema = z.array(ChatModelSchema);

export type ChatModel = z.infer<typeof ChatModelSchema>;

export type EngineRuntimeModelConfig = {
  /** The legacy engine model string, kept for older runtime paths. */
  spec: string;
  /** Dashboard provider preset id. */
  provider: ProviderPreset;
  /** Engine wire protocol selected in /models. */
  protocol: ChatProtocol;
  /** Engine endpoint base URL from /models. */
  baseURL?: string;
  /** Model id exactly as the provider expects it on the wire. */
  modelName: string;
  /** Kody vault key exposed only to the selected Engine model process. */
  apiKeyEnvVar: string;
};

export function pickModelById(
  models: ChatModel[],
  id: string | undefined | null,
): ChatModel | null {
  if (!id) return null;
  return models.find((m) => m.enabled !== false && m.id === id) ?? null;
}

export function pickDefaultModel(models: ChatModel[]): ChatModel | null {
  const enabled = models.filter((m) => m.enabled !== false);
  return enabled.find((m) => m.default === true) ?? enabled[0] ?? null;
}

/**
 * Pick the model the engine should run. Prefers the entry flagged
 * `engineDefault`; when none is set, falls back to the chat default so a
 * single "default" pick still drives both surfaces.
 */
export function pickEngineDefaultModel(models: ChatModel[]): ChatModel | null {
  const enabled = models.filter((m) => m.enabled !== false);
  return (
    enabled.find((m) => m.engineDefault === true) ?? pickDefaultModel(models)
  );
}

/**
 * The `provider/model` string the engine expects in `agent.model`
 * (see kody-engine `parseProviderModel`). Prefers the entry `id` when it's
 * already in `provider/model` form — that's the user's escape hatch and is
 * how non-preset providers like `minimax/MiniMax-M3` are
 * spelled. Otherwise it's built from the preset provider + wire model name.
 *
 * Caveat: preset provider names mostly match LiteLLM's (anthropic, openai,
 * groq, mistral, deepseek, xai, openrouter). `google` is the exception
 * (LiteLLM wants `gemini/...`) and `custom` has no provider — for those,
 * set the `id` explicitly to the correct `provider/model`.
 */
export function engineModelSpec(m: ChatModel): string {
  const id = m.id.trim();
  if (id.includes("/")) return id;
  return `${m.provider}/${m.modelName.trim()}`;
}

export function engineRuntimeModelConfig(
  m: ChatModel,
): EngineRuntimeModelConfig {
  const baseURL = m.baseURL.trim();
  return {
    spec: engineModelSpec(m),
    provider: m.provider,
    protocol: m.protocol,
    ...(baseURL ? { baseURL } : {}),
    modelName: m.modelName.trim(),
    apiKeyEnvVar: m.apiKeySecret.trim(),
  };
}

/** Engine-ready Automatic queue in the same order shown on Chat Models. */
export function engineAutomaticModelConfigs(
  models: ChatModel[],
): EngineRuntimeModelConfig[] {
  return models
    .filter((model) => model.enabled !== false && model.automatic === true)
    .map(engineRuntimeModelConfig);
}
