import { describe, expect, it } from "vitest";
import { ONBOARDING_FLOW } from "../../src/dashboard/lib/guided-flows/builtins/onboarding";

describe("onboarding provider branch", () => {
  it("starts with Chat setup and ends with the ready screen", () => {
    expect(ONBOARDING_FLOW.version).toBe(5);
    expect(ONBOARDING_FLOW.steps[0]?.id).toBe("choose-chat-provider");
    expect(ONBOARDING_FLOW.steps.at(-1)?.id).toBe("welcome");
  });

  it("offers OpenRouter, xKiro, and skip actions", () => {
    const step = ONBOARDING_FLOW.steps.find(
      (candidate) => candidate.id === "choose-chat-provider",
    );
    const viewStep = step && "rendererData" in step ? step : undefined;

    expect(viewStep?.rendererData).toMatchObject({
      title: "Set up Chat",
      actions: [
        { id: "openrouter", label: "Set up OpenRouter" },
        { id: "xkiro", label: "Set up xKiro" },
        { id: "skip", label: "Skip for now" },
      ],
    });
    expect(step?.actions).toEqual([
      { id: "openrouter", target: { type: "step", stepId: "add-openrouter-key" } },
      { id: "xkiro", target: { type: "step", stepId: "add-xkiro-key" } },
      { id: "skip", target: { type: "step", stepId: "welcome" } },
    ]);
  });

  it("verifies each provider before showing the ready screen", () => {
    expect(
      ONBOARDING_FLOW.steps.find(
        (candidate) => candidate.id === "add-openrouter-key",
      )?.actions,
    ).toEqual([
      { id: "next", target: { type: "step", stepId: "verify-openrouter" } },
    ]);
    expect(
      ONBOARDING_FLOW.steps.find(
        (candidate) => candidate.id === "add-xkiro-key",
      )?.actions,
    ).toEqual([
      { id: "next", target: { type: "step", stepId: "verify-xkiro" } },
    ]);
    expect(
      ONBOARDING_FLOW.steps.find(
        (candidate) => candidate.id === "verify-openrouter",
      ),
    ).toMatchObject({
      type: "command",
      command: "/check-chat openrouter/free",
      actions: [
        { id: "run", target: { type: "stay" } },
        { id: "continue", target: { type: "step", stepId: "welcome" } },
      ],
    });
    expect(
      ONBOARDING_FLOW.steps.find(
        (candidate) => candidate.id === "verify-xkiro",
      ),
    ).toMatchObject({
      type: "command",
      command: "/check-chat xkiro/deepseek/deepseek-v4-flash",
    });
  });
});
