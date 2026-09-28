/**
 * Shared chat-model resolution.
 *
 * Both the streaming chat route (`/api/kody/chat/kody`) and lightweight
 * one-shot routes (e.g. `/api/kody/chat/title`) need the same chain:
 * compose the configured + built-in model catalog → pick one (explicit id or default) →
 * read its per-model API key from the vault → build a Vercel-AI
 * `LanguageModel` for the right wire protocol.
 *
 * Keeping this in one place means a fix to key/protocol handling lands
 * everywhere at once and the title route can't drift from the chat route.
 */
import { NextRequest, NextResponse } from "next/server";
import type { LanguageModel } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { getRequestAuth, getUserOctokit } from "@kody-ade/base/auth";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { getSecret } from "@kody-ade/base/vault/get-secret";
import { chatModelAdapter, chatModelAdapterBaseURL } from "./model-adapters";
import { loadOpenCodeFreeModels } from "./opencode-free";
import { supportsVision } from "@kody-ade/kody-chat-dashboard/core/vision-support";
import {
  loadAutomaticModel,
  loadChatModels,
} from "@kody-ade/base/variables/load-chat-models";
import {
  KODY_BUILT_IN_CHAT_MODELS,
  composeChatModelCatalog,
  openCodeChatModels,
  OPENCODE_FREE_MODEL_ID,
} from "@kody-ade/kody-chat-dashboard/chat/model-catalog";
import {
  AUTOMATIC_MODEL_ID,
  PROVIDER_PRESETS,
  chatModelScopeFromId,
  pickModelById,
  pickDefaultModel,
  type ChatModel,
  type ProviderPreset,
} from "@kody-ade/base/variables/models";
import {
  createAutomaticLanguageModel,
  type AutomaticFallbackEvent,
} from "@kody-ade/kody-chat-dashboard/core/automatic-language-model";
import {
  observeLanguageModelCalls,
  type ModelCallEvent,
} from "@kody-ade/kody-chat-dashboard/core/model-call-observer";
import {
  getChatModelSettingsProvider,
  type ChatModelSettingsProvider,
} from "./model-settings-provider";

async function resolveModelCredential(
  req: NextRequest,
  model: ChatModel,
  personalProvider: ChatModelSettingsProvider | null,
): Promise<string | null> {
  if (model.provider === "opencode-free") return "";
  const name = model.apiKeySecret;
  if (getRequestAuth(req)) {
    const repositoryValue = await getSecret(name, { req, vaultOnly: true });
    if (repositoryValue) return repositoryValue;
  }
  if (chatModelScopeFromId(model.id) === "repo") return null;
  const personalValue = personalProvider
    ? await personalProvider.getCredential(req, name)
    : null;
  if (personalValue) return personalValue;
  return getSecret(name, { req });
}

export type ResolvedChatModel = {
  model: LanguageModel;
  plannerModel: LanguageModel;
  resolvedModel: ChatModel;
  apiKey: string;
};

export type ResolveChatModelOptions = {
  preferVision?: boolean;
  onAutomaticFallback?: (event: AutomaticFallbackEvent) => void;
  onModelCall?: (event: ModelCallEvent) => void;
};

function observeModel(
  model: LanguageModelV3,
  options: ResolveChatModelOptions,
): LanguageModelV3 {
  return options.onModelCall
    ? observeLanguageModelCalls(model, { onEvent: options.onModelCall })
    : model;
}

const ENGINE_PROVIDER_ALIASES: Record<string, ProviderPreset> = {
  anthropic: "anthropic",
  claude: "anthropic",
  google: "google",
  gemini: "google",
  openai: "openai",
  openrouter: "openrouter",
  groq: "groq",
  mistral: "mistral",
  deepseek: "deepseek",
  xai: "xai",
  grok: "xai",
  minimax: "minimax",
};

function chatModelFromEngineSpec(
  modelSpec: string | undefined,
): ChatModel | null {
  const spec = modelSpec?.trim();
  if (!spec) return null;
  const slash = spec.indexOf("/");
  if (slash <= 0 || slash === spec.length - 1) return null;
  const providerKey = spec.slice(0, slash).trim().toLowerCase();
  const modelName = spec.slice(slash + 1).trim();
  const provider = ENGINE_PROVIDER_ALIASES[providerKey];
  if (!provider || !modelName) return null;
  const preset = PROVIDER_PRESETS[provider];
  return {
    id: `engine:${spec}`,
    label: `Engine default (${spec})`,
    provider,
    protocol: preset.protocol,
    baseURL: preset.baseURL,
    modelName,
    apiKeySecret: preset.keyHint,
    enabled: true,
    default: true,
    engineDefault: true,
  };
}

async function loadEngineFallbackModel(
  req: NextRequest,
): Promise<ChatModel | null> {
  const auth = getRequestAuth(req);
  if (auth) {
    const octokit = await getUserOctokit(req);
    if (octokit) {
      try {
        const { config } = await getEngineConfig(
          octokit,
          auth.owner,
          auth.repo,
        );
        const model = chatModelFromEngineSpec(config.agent?.model);
        if (model) return model;
      } catch {
        // Keep the visible failure about chat model availability, not a
        // secondary config read problem.
      }
    }
  }

  return (
    chatModelFromEngineSpec(process.env.KODY_CHAT_MODEL) ??
    chatModelFromEngineSpec(process.env.KODY_ENGINE_MODEL) ??
    chatModelFromEngineSpec(process.env.E2E_CHAT_MODEL)
  );
}

function modelSupportsVision(model: ChatModel): boolean {
  return supportsVision(model.id) || supportsVision(model.modelName);
}

function isMiniMaxM2Model(model: ChatModel): boolean {
  const spec = `${model.id} ${model.label} ${model.modelName}`.toLowerCase();
  return /(?:^|[/:_\s-])(?:minimax[-_])?m2(?:[._-]|$)/.test(spec);
}

function isMiniMaxModel(model: ChatModel): boolean {
  const spec = `${model.id} ${model.label} ${model.modelName}`.toLowerCase();
  return spec.includes("minimax");
}

function isEmbeddingModel(model: ChatModel): boolean {
  const spec = `${model.id} ${model.label} ${model.modelName}`.toLowerCase();
  return /(?:embed|embedding|text-embedding|bge-|e5-)/.test(spec);
}

function pickVisionModel(
  model: ChatModel,
  availableModels: ChatModel[],
): ChatModel {
  if (!isMiniMaxM2Model(model)) return model;

  const configuredMiniMaxVisionModels = availableModels.filter(
    (candidate) =>
      candidate.enabled !== false &&
      isMiniMaxModel(candidate) &&
      modelSupportsVision(candidate),
  );
  const configured =
    configuredMiniMaxVisionModels.find(
      (candidate) => candidate.apiKeySecret === model.apiKeySecret,
    ) ?? configuredMiniMaxVisionModels[0];
  if (configured) return configured;

  return {
    ...model,
    id: model.id.startsWith("engine:")
      ? "engine:minimax/MiniMax-M3"
      : "minimax/MiniMax-M3",
    label: "MiniMax-M3 (image turns)",
    modelName: "MiniMax-M3",
    default: false,
    engineDefault: false,
  };
}

/**
 * Resolve a chat model from the request, or return a 409 `NextResponse`
 * describing what's missing (same error envelope the chat route returns,
 * so existing client fallback handling keeps working).
 *
 * `modelId` is an optional client-supplied override; it must match an
 * enabled entry — arbitrary ids from the wire are never trusted.
 */
export async function resolveChatModel(
  req: NextRequest,
  modelId?: string,
  options: ResolveChatModelOptions = {},
): Promise<ResolvedChatModel | { error: NextResponse }> {
  const settingsProvider = getChatModelSettingsProvider();
  const personalSettings = settingsProvider
    ? await settingsProvider.load(req)
    : null;
  const requestSettingsProvider = personalSettings ? settingsProvider : null;
  const availableModels = composeChatModelCatalog(
    personalSettings?.models ?? (await loadChatModels(req)),
    KODY_BUILT_IN_CHAT_MODELS,
  );
  const automatic =
    personalSettings?.automatic ?? (await loadAutomaticModel(req));
  const effectiveModelId =
    modelId ?? (automatic.default === true ? AUTOMATIC_MODEL_ID : undefined);
  if (effectiveModelId === OPENCODE_FREE_MODEL_ID) {
    try {
      const freeModels = openCodeChatModels(await loadOpenCodeFreeModels());
      if (!freeModels.length)
        throw new Error(
          "OpenCode has no free models available. Choose another provider or try later.",
        );
      const candidates = freeModels.map((config) => ({
        id: config.label,
        model: observeModel(
          chatModelAdapter(config).create(config, "") as LanguageModelV3,
          options,
        ),
      }));
      const model =
        candidates.length === 1
          ? candidates[0].model
          : createAutomaticLanguageModel(candidates, {
              onFallback: options.onAutomaticFallback,
            });
      return {
        model,
        plannerModel: model,
        resolvedModel: {
          ...freeModels[0],
          id: OPENCODE_FREE_MODEL_ID,
          label: "OpenCode Free",
          modelName: OPENCODE_FREE_MODEL_ID,
        },
        apiKey: "",
      };
    } catch (error) {
      return {
        error: NextResponse.json(
          {
            error: "model_unavailable",
            message:
              error instanceof Error
                ? error.message
                : "OpenCode Free is unavailable.",
          },
          { status: 409 },
        ),
      };
    }
  }
  if (effectiveModelId?.startsWith("opencode-free/")) {
    try {
      const freeModels = openCodeChatModels(await loadOpenCodeFreeModels());
      const selected = freeModels.find(
        (model) => model.id === effectiveModelId,
      );
      if (!selected)
        throw new Error(
          "This model is no longer available for free. Choose another model.",
        );
      if (!availableModels.some((model) => model.id === selected.id))
        availableModels.push(selected);
    } catch (error) {
      return {
        error: NextResponse.json(
          {
            error: "model_unavailable",
            message:
              error instanceof Error
                ? error.message
                : "OpenCode Free is unavailable.",
          },
          { status: 409 },
        ),
      };
    }
  }
  if (effectiveModelId === AUTOMATIC_MODEL_ID) {
    const candidates = availableModels.filter(
      (candidate) =>
        candidate.enabled !== false &&
        candidate.automatic === true &&
        !isEmbeddingModel(candidate),
    );
    if (candidates.length < 2) {
      return {
        error: NextResponse.json(
          {
            error: "automatic_requires_models",
            fallback: "kody-live",
            message:
              "Automatic requires at least two selected chat models under /models.",
          },
          { status: 409 },
        ),
      };
    }
    const resolvedCandidates: Array<{ id: string; model: LanguageModelV3 }> =
      [];
    let firstResolvedModel: ChatModel | null = null;
    for (const candidate of candidates) {
      let resolved = options.preferVision
        ? pickVisionModel(candidate, availableModels)
        : candidate;
      try {
        resolved = await refreshFreeModel(resolved);
      } catch {
        continue;
      }
      const apiKey = await resolveModelCredential(
        req,
        resolved,
        requestSettingsProvider,
      );
      if (
        apiKey === null ||
        (!apiKey && resolved.provider !== "opencode-free")
      ) {
        continue;
      }
      const adapter = chatModelAdapter(resolved);
      if (adapter.requiresBaseURL && !chatModelAdapterBaseURL(resolved)) {
        return {
          error: NextResponse.json(
            {
              error: "model_base_url_missing",
              fallback: "kody-live",
              message: `Model ${resolved.id} has no baseURL. Edit it under /models.`,
            },
            { status: 409 },
          ),
        };
      }
      firstResolvedModel ??= resolved;
      resolvedCandidates.push({
        id: resolved.label || resolved.modelName,
        model: observeModel(
          adapter.create(resolved, apiKey) as LanguageModelV3,
          options,
        ),
      });
    }
    if (resolvedCandidates.length < 2 || !firstResolvedModel) {
      return {
        error: NextResponse.json(
          {
            error: "automatic_requires_configured_models",
            fallback: "kody-live",
            message:
              "Automatic requires at least two selected models with configured credentials.",
          },
          { status: 409 },
        ),
      };
    }
    const automaticOptions = {
      onFallback: options.onAutomaticFallback,
    };
    return {
      model: createAutomaticLanguageModel(
        resolvedCandidates,
        automaticOptions,
      ) as LanguageModel,
      plannerModel: createAutomaticLanguageModel(resolvedCandidates, {
        ...automaticOptions,
        candidateTimeoutMs: 4_000,
      }) as LanguageModel,
      resolvedModel: {
        ...firstResolvedModel,
        id: AUTOMATIC_MODEL_ID,
        label: "Automatic",
        default: false,
        engineDefault: false,
      },
      apiKey: "",
    };
  }
  const requestedModel = effectiveModelId
    ? pickModelById(availableModels, effectiveModelId)
    : null;
  if (requestedModel && isEmbeddingModel(requestedModel)) {
    return {
      error: NextResponse.json(
        {
          error: "model_not_chat_capable",
          fallback: "kody-live",
          message: `${requestedModel.label || requestedModel.modelName} is an embedding model, not a chat model. Choose a Gemini, MiniMax, OpenAI, or other chat model under /models.`,
        },
        { status: 409 },
      ),
    };
  }
  const chatModels = availableModels.filter(
    (model) => !isEmbeddingModel(model),
  );
  const selectedModel =
    requestedModel ??
    pickDefaultModel(chatModels) ??
    (await loadEngineFallbackModel(req));
  if (!selectedModel) {
    return {
      error: NextResponse.json(
        {
          error: "no_models_configured",
          fallback: "kody-live",
          message:
            "No chat models configured. Add one at /models, or fall back to Kody Live.",
        },
        { status: 409 },
      ),
    };
  }
  let resolvedModel = options.preferVision
    ? pickVisionModel(selectedModel, availableModels)
    : selectedModel;

  try {
    resolvedModel = await refreshFreeModel(resolvedModel);
  } catch (error) {
    return {
      error: NextResponse.json(
        {
          error: "model_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "OpenCode Free is unavailable. Choose another model.",
        },
        { status: 409 },
      ),
    };
  }

  const apiKey = await resolveModelCredential(
    req,
    resolvedModel,
    requestSettingsProvider,
  );
  if (
    apiKey === null ||
    (!apiKey && resolvedModel.provider !== "opencode-free")
  ) {
    return {
      error: NextResponse.json(
        {
          error: "model_api_key_missing",
          fallback: "kody-live",
          message: `${resolvedModel.apiKeySecret} is not set. Add it under /secrets, or fall back to Kody Live.`,
        },
        { status: 409 },
      ),
    };
  }

  const adapter = chatModelAdapter(resolvedModel);
  if (adapter.requiresBaseURL && !chatModelAdapterBaseURL(resolvedModel)) {
    return {
      error: NextResponse.json(
        {
          error: "model_base_url_missing",
          fallback: "kody-live",
          message: `Model ${resolvedModel.id} has no baseURL. Edit it under /models.`,
        },
        { status: 409 },
      ),
    };
  }
  const model: LanguageModel = observeModel(
    adapter.create(resolvedModel, apiKey) as LanguageModelV3,
    options,
  ) as LanguageModel;

  return { model, plannerModel: model, resolvedModel, apiKey };
}

async function refreshFreeModel(model: ChatModel): Promise<ChatModel> {
  if (model.provider !== "opencode-free") return model;
  const entry = (await loadOpenCodeFreeModels()).find(
    (entry) => entry.id === model.modelName,
  );
  if (!entry)
    throw new Error(
      "This model is no longer listed as free by OpenCode. Choose another model under /models.",
    );
  return {
    ...model,
    adapter: entry.adapter,
    baseURL: PROVIDER_PRESETS["opencode-free"].baseURL,
    adapterBaseURL: PROVIDER_PRESETS["opencode-free"].adapterBaseURL,
    apiKeySecret: "",
    engineDefault: false,
  };
}
