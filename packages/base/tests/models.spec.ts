import { describe, expect, it } from "vitest";

import {
  AUTOMATIC_MODEL_ID,
  AutomaticModelSchema,
  ChatModelSchema,
  engineAutomaticModelConfigs,
  PROVIDER_PRESETS,
} from "../src/variables/models";

const baseModel = {
  id: "google/gemini-next",
  label: "Gemini Next",
  provider: "google" as const,
  baseURL: "https://generativelanguage.googleapis.com/v1beta",
  modelName: "gemini-next",
  apiKeySecret: "GEMINI_API_KEY",
};

describe("chat model adapters", () => {
  it("keeps Automatic separate from the concrete model schema", () => {
    expect(AUTOMATIC_MODEL_ID).toBe("automatic");
    expect(AutomaticModelSchema.parse({ engineDefault: true })).toEqual({
      default: false,
      engineDefault: true,
    });
  });

  it("defines the xKiro OpenAI-compatible provider preset", () => {
    expect(PROVIDER_PRESETS.xkiro).toMatchObject({
      label: "xKiro",
      adapter: "openai-compatible",
      adapterBaseURL: "https://api.xkiro.com/v1",
      baseURL: "https://api.xkiro.com/v1",
      protocol: "openai",
      keyHint: "XKIRO_API_KEY",
    });
  });

  it("builds the Engine Automatic queue from selected enabled models in saved order", () => {
    const first = ChatModelSchema.parse({
      ...baseModel,
      protocol: "openai",
      automatic: true,
    });
    const disabled = ChatModelSchema.parse({
      ...baseModel,
      id: "openai/off",
      label: "Off",
      provider: "openai",
      protocol: "openai",
      baseURL: "https://api.openai.com/v1",
      modelName: "off",
      apiKeySecret: "OPENAI_API_KEY",
      enabled: false,
      automatic: true,
    });
    const second = ChatModelSchema.parse({
      ...baseModel,
      id: "anthropic/claude-next",
      label: "Claude Next",
      provider: "anthropic",
      protocol: "anthropic",
      baseURL: "https://api.anthropic.com/v1",
      modelName: "claude-next",
      apiKeySecret: "ANTHROPIC_API_KEY",
      automatic: true,
    });
    const enabledButNotSelected = ChatModelSchema.parse({
      ...baseModel,
      id: "openai/other",
      label: "Other",
      provider: "openai",
      protocol: "openai",
      baseURL: "https://api.openai.com/v1",
      modelName: "other",
      apiKeySecret: "OPENAI_API_KEY",
    });

    expect(
      engineAutomaticModelConfigs([
        first,
        disabled,
        enabledButNotSelected,
        second,
      ]),
    ).toEqual([
      expect.objectContaining({ spec: first.id, modelName: first.modelName }),
      expect.objectContaining({
        spec: second.id,
        modelName: second.modelName,
      }),
    ]);
  });

  it("preserves declared tool-choice capabilities", () => {
    expect(
      ChatModelSchema.parse({
        ...baseModel,
        protocol: "openai",
        toolChoice: { required: true, named: false },
      }),
    ).toMatchObject({
      toolChoice: { required: true, named: false },
    });
  });

  it("preserves a model service bound to an existing machine selection", () => {
    expect(
      ChatModelSchema.parse({
        ...baseModel,
        protocol: "openai",
        service: {
          machine: "local",
          startCommand: "llama-server --port 8080",
          stopCommand: "pkill -INT -f llama-server",
        },
      }),
    ).toMatchObject({
      service: {
        machine: "local",
        startCommand: "llama-server --port 8080",
        stopCommand: "pkill -INT -f llama-server",
      },
    });
  });

  it("uses the native Google adapter for new Google models", () => {
    expect(PROVIDER_PRESETS.google.adapter).toBe("google");
    expect(
      ChatModelSchema.parse({
        ...baseModel,
        protocol: "openai",
      }),
    ).toMatchObject({
      provider: "google",
      adapter: "google",
      adapterBaseURL: "https://generativelanguage.googleapis.com/v1beta",
      protocol: "openai",
      modelName: "gemini-next",
    });
  });

  it("adds the native adapter to existing Google model records", () => {
    expect(
      ChatModelSchema.parse({
        ...baseModel,
        protocol: "openai",
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      }),
    ).toMatchObject({
      provider: "google",
      adapter: "google",
      adapterBaseURL: "https://generativelanguage.googleapis.com/v1beta",
      protocol: "openai",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    });
  });

  it("keeps non-Google compatible providers on the generic adapter", () => {
    expect(
      ChatModelSchema.parse({
        ...baseModel,
        id: "custom/example",
        provider: "custom",
        protocol: "openai",
        baseURL: "https://models.example.test/v1",
      }),
    ).toMatchObject({
      provider: "custom",
      adapter: "openai-compatible",
      protocol: "openai",
      baseURL: "https://models.example.test/v1",
    });
  });
});
