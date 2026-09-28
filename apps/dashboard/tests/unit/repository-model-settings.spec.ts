import { describe, expect, it } from "vitest";
import { mergeChatModelSettings } from "@dashboard/lib/chat/personal-model-settings";
import {
  KODY_BUILT_IN_CHAT_MODELS,
  composeChatModelCatalog,
} from "@kody-ade/kody-chat-dashboard/chat/model-catalog";

const model = (id: string, defaults = false) => ({
  id,
  label: id,
  provider: "anthropic" as const,
  protocol: "anthropic" as const,
  baseURL: "https://api.anthropic.com",
  modelName: id,
  apiKeySecret: "ANTHROPIC_API_KEY",
  enabled: true,
  default: defaults,
});

describe("repository chat model settings", () => {
  it("keeps personal and repo choices distinct when their stored ids match", () => {
    const result = mergeChatModelSettings(
      {
        models: [model("same"), model("personal")],
        automatic: { default: false, engineDefault: false },
      },
      {
        models: [model("same"), model("repository", true)],
        automatic: { default: false, engineDefault: false },
      },
    );

    expect(result.models.map(({ id }) => id)).toEqual([
      "repo::same",
      "repo::repository",
      "personal::same",
      "personal::personal",
    ]);
    expect(
      result.models.find(({ id }) => id === "personal::personal")?.default,
    ).toBe(false);
  });

  it("keeps a built-in saved by Personal Models as one global Chat choice", () => {
    const builtIn = KODY_BUILT_IN_CHAT_MODELS[0];
    const merged = mergeChatModelSettings(
      {
        models: [{ ...builtIn, automatic: true }],
        automatic: { default: false, engineDefault: false },
      },
      {
        models: [],
        automatic: { default: false, engineDefault: false },
      },
    );
    const catalog = composeChatModelCatalog(
      merged.models,
      KODY_BUILT_IN_CHAT_MODELS,
    );

    expect(catalog.filter(({ id }) => id === builtIn.id)).toHaveLength(1);
    expect(catalog).toHaveLength(KODY_BUILT_IN_CHAT_MODELS.length);
  });
});
