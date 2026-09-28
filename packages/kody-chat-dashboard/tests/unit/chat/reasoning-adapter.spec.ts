import { describe, expect, it } from "vitest";

import {
  FALLBACK_REASONING,
  applyReasoning,
  defaultReasoningForModel,
  resolveReasoning,
} from "../../../src/dashboard/lib/chat/core/reasoning-adapter";

describe("reasoning adapter compatibility", () => {
  it.each([
    ["openai/o1", "on", "openai_effort"],
    ["openai/gpt-5", "medium", "openai_effort"],
    ["google/gemini-3-pro", "medium", "gemini_level"],
    ["google/gemini-2.5-pro", "medium", "gemini_budget"],
    ["xai/grok-4", "low", "xai_effort"],
    ["mistral/magistral-medium", "medium", "openai_extra_body"],
    ["minimax/MiniMax-M3", "low", "openai_effort"],
  ] as const)(
    "preserves inferred reasoning for %s",
    (id, expectedDefault, expectedWire) => {
      expect(defaultReasoningForModel({ id })).toMatchObject({
        default: expectedDefault,
        wire: expectedWire,
      });
    },
  );

  it("preserves the protocol-dependent Claude wire format", () => {
    expect(
      defaultReasoningForModel({
        id: "anthropic/claude-sonnet-4",
        protocol: "anthropic",
      }),
    ).toMatchObject({ wire: "anthropic_budget" });
    expect(
      defaultReasoningForModel({
        id: "openrouter/anthropic/claude-sonnet-4",
        protocol: "openai",
      }),
    ).toMatchObject({ wire: "openai_extra_body" });
  });

  it("keeps an explicit model declaration ahead of inferred behavior", () => {
    const explicit = {
      efforts: [{ value: "fast", label: "Fast" }],
      default: "fast",
      wire: "openai_extra_body" as const,
    };

    expect(
      resolveReasoning({ id: "minimax/MiniMax-M3", reasoning: explicit }),
    ).toEqual(explicit);
  });

  it("keeps the generic fallback for an unknown configured model", () => {
    expect(resolveReasoning({ id: "vendor/future-model" })).toEqual(
      FALLBACK_REASONING,
    );
  });

  it("preserves every supported reasoning wire shape", () => {
    const cases = [
      [
        "anthropic_budget",
        {
          providerOptions: {
            anthropic: {
              thinking: { type: "enabled", budgetTokens: 10_000 },
            },
          },
        },
      ],
      [
        "openai_effort",
        { providerOptions: { openai: { reasoningEffort: "medium" } } },
      ],
      [
        "openai_extra_body",
        {
          providerOptions: {
            openai: { extraBody: { reasoning: { effort: "medium" } } },
          },
        },
      ],
      [
        "gemini_budget",
        {
          providerOptions: {
            google: { thinkingConfig: { thinkingBudget: 8_192 } },
          },
        },
      ],
      [
        "gemini_level",
        {
          providerOptions: {
            google: { thinkingConfig: { thinkingLevel: "medium" } },
          },
        },
      ],
      [
        "xai_effort",
        { providerOptions: { xai: { reasoningEffort: "medium" } } },
      ],
    ] as const;

    for (const [wire, expected] of cases) {
      expect(
        applyReasoning(
          {
            reasoning: {
              efforts: [{ value: "medium", label: "Medium" }],
              default: "medium",
              wire,
            },
          },
          "medium",
        ),
      ).toEqual(expected);
    }
  });
});
