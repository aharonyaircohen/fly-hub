/**
 * @fileType adapter
 * @domain chat
 * @pattern provider-adapter-registry
 * @ai-summary Creates AI SDK language models from saved adapter metadata.
 * Model names are opaque configuration data; only the adapter selects code.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import {
  PROVIDER_PRESETS,
  type ChatAdapter,
  type ChatModel,
} from "@kody-ade/base/variables/models";
import type { LanguageModel } from "ai";

import { normalizeOpenAICompatibleRequestBody } from "@kody-ade/kody-chat-dashboard/core/openai-compatible-request";

export interface ChatModelAdapter {
  requiresBaseURL: boolean;
  create(model: ChatModel, apiKey: string): LanguageModel;
}

function adapterBaseURL(model: ChatModel): string {
  if (model.provider === "opencode-free")
    return PROVIDER_PRESETS["opencode-free"].baseURL;
  return (
    model.adapterBaseURL?.trim() ||
    PROVIDER_PRESETS[model.provider].adapterBaseURL ||
    model.baseURL.trim()
  );
}

export const CHAT_MODEL_ADAPTERS: Record<ChatAdapter, ChatModelAdapter> = {
  "openai-responses": {
    requiresBaseURL: true,
    create(model, apiKey) {
      return createOpenAI({
        baseURL: adapterBaseURL(model),
        apiKey: model.provider === "opencode-free" ? "anonymous" : apiKey,
        ...(model.provider === "opencode-free"
          ? { fetch: anonymousOpenCodeFetch }
          : {}),
      }).responses(model.modelName);
    },
  },
  anthropic: {
    requiresBaseURL: false,
    create(model, apiKey) {
      const baseURL = adapterBaseURL(model);
      const provider = createAnthropic({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return provider(model.modelName);
    },
  },
  google: {
    requiresBaseURL: false,
    create(model, apiKey) {
      const baseURL = adapterBaseURL(model);
      const provider = createGoogleGenerativeAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      });
      return provider(model.modelName);
    },
  },
  "openai-compatible": {
    requiresBaseURL: true,
    create(model, apiKey) {
      const baseURL = adapterBaseURL(model);
      const provider = createOpenAICompatible({
        name: model.provider,
        apiKey: model.provider === "opencode-free" ? undefined : apiKey,
        baseURL,
        ...(model.provider === "opencode-free"
          ? { fetch: anonymousOpenCodeFetch }
          : {}),
        transformRequestBody: normalizeOpenAICompatibleRequestBody,
      });
      return provider(model.modelName);
    },
  },
};

/** Never forward caller/SDK credentials to the anonymous service. */
export const anonymousOpenCodeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    url.origin !== "https://opencode.ai" ||
    !["/zen/v1/chat/completions", "/zen/v1/responses"].includes(url.pathname)
  ) {
    throw new Error("Invalid OpenCode Free endpoint");
  }
  request.headers.delete("authorization");
  request.headers.delete("cookie");
  return fetch(request, { redirect: "error" });
};

export function chatAdapterId(model: ChatModel): ChatAdapter {
  return model.adapter ?? PROVIDER_PRESETS[model.provider].adapter;
}

export function chatModelAdapter(model: ChatModel): ChatModelAdapter {
  return CHAT_MODEL_ADAPTERS[chatAdapterId(model)];
}

export function chatModelAdapterBaseURL(model: ChatModel): string {
  return adapterBaseURL(model);
}
