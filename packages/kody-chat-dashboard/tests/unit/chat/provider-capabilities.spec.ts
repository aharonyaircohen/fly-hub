import { describe, expect, it } from "vitest";
import type { ChatModel } from "@kody-ade/base/variables/models";
import {
  getChatProviderCapabilities,
  type ChatProviderModel,
} from "../../../src/dashboard/lib/chat/core/provider-capabilities";

function model(overrides: Partial<ChatProviderModel> = {}): ChatProviderModel {
  return { ...overrides };
}

describe("chat provider capabilities", () => {
  it("treats undeclared OpenRouter capabilities as unknown", () => {
    const openRouterModel: ChatModel = {
      id: "openrouter/free",
      label: "OpenRouter Free",
      provider: "openrouter",
      protocol: "openai",
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "openrouter/free",
      apiKeySecret: "OPENROUTER_API_KEY",
      enabled: true,
    };

    expect(getChatProviderCapabilities(openRouterModel)).toEqual({
      supportsRequiredToolChoice: false,
      supportsNamedToolChoice: false,
    });
  });

  it("uses declared capabilities without provider-specific inference", () => {
    expect(
      getChatProviderCapabilities(
        model({
          toolChoice: { required: true, named: true },
        }),
      ),
    ).toEqual({
      supportsRequiredToolChoice: true,
      supportsNamedToolChoice: true,
    });
  });

  it("honors partial capability declarations", () => {
    expect(
      getChatProviderCapabilities(
        model({ toolChoice: { required: true, named: false } }),
      ),
    ).toEqual({
      supportsRequiredToolChoice: true,
      supportsNamedToolChoice: false,
    });
  });
});
