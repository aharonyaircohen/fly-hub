import { describe, expect, it } from "vitest";
import {
  BrainChatModelsSchema,
  normalizeBrainChatModels,
} from "../../src/chat-models";

describe("Brain chat models", () => {
  it("accepts named models with user-defined runtime commands", () => {
    const result = BrainChatModelsSchema.safeParse([
      {
        id: "personal-codex",
        name: "Personal Codex",
        runtime: "codex app-server",
        enabled: true,
        default: true,
      },
    ]);

    expect(result.success).toBe(true);
  });

  it("rejects blank names and runtime commands", () => {
    const result = BrainChatModelsSchema.safeParse([
      { id: "x", name: " ", runtime: " " },
    ]);

    expect(result.success).toBe(false);
  });

  it("keeps only one default model", () => {
    expect(
      normalizeBrainChatModels([
        { id: "a", name: "A", runtime: "a", enabled: true, default: true },
        { id: "b", name: "B", runtime: "b", enabled: true, default: true },
      ]),
    ).toEqual([
      { id: "a", name: "A", runtime: "a", enabled: true, default: true },
      { id: "b", name: "B", runtime: "b", enabled: true, default: false },
    ]);
  });
});
