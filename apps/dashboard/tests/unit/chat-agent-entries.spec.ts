/**
 * Unit tests for the model picker contract.
 *
 * Live and Brain are first-class chat backends. Configured custom models are
 * shown alongside them.
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentList,
  type BrainChatModelEntry,
  type ChatModelEntry,
} from "@kody-ade/kody-chat-dashboard/platform/agent-entries";
import { AGENTS } from "@dashboard/lib/agents";
import {
  FALLBACK_REASONING,
  resolveReasoning,
} from "@kody-ade/kody-chat-dashboard/core/reasoning-adapter";

const model = (
  over: Partial<ChatModelEntry> & { id: string },
): ChatModelEntry => ({
  label: over.id,
  ...over,
});

describe("buildAgentList", () => {
  it("always shows Live when no Brain or custom model is configured", () => {
    expect(buildAgentList(false, false, false, []).map((e) => e.key)).toEqual([
      "kody-live",
    ]);
  });

  it("shows manual Brain when configured", () => {
    expect(buildAgentList(true, false, false, []).map((e) => e.key)).toEqual([
      "kody-live",
      "brain",
    ]);
  });

  it("shows enabled personal Brain models by name", () => {
    const brainModels: BrainChatModelEntry[] = [
      { id: "personal", name: "Personal Brain", enabled: true },
      { id: "disabled", name: "Disabled Brain", enabled: false },
    ];
    expect(
      buildAgentList(false, false, false, [], brainModels).map((e) => e.key),
    ).toEqual(["kody-live", "brain:personal"]);
    expect(
      buildAgentList(false, false, false, [], brainModels)[1],
    ).toMatchObject({
      agentId: "brain",
      modelId: "personal",
      name: "Personal Brain",
    });
  });

  it("prefers Repo Brain when Fly chat is enabled", () => {
    expect(buildAgentList(true, true, true, []).map((e) => e.key)).toEqual([
      "kody-live-fly",
      "brain-fly",
    ]);
  });

  it("maps enabled custom models and drops disabled ones", () => {
    const list = buildAgentList(false, false, false, [
      model({ id: "gpt-x", label: "GPT X" }),
      model({ id: "off", enabled: false }),
      model({ id: "claude-y", label: "Claude Y", enabled: true }),
    ]);
    const byKey = new Map(list.map((entry) => [entry.key, entry]));
    const gptX = byKey.get("kody:gpt-x");
    expect(gptX).toMatchObject({
      key: "kody:gpt-x",
      agentId: "kody",
      modelId: "gpt-x",
      name: "GPT X",
      description: "gpt-x",
      modelGroup: "user",
      icon: AGENTS.kody.icon,
    });
    expect(gptX?.reasoning).toEqual(FALLBACK_REASONING);
    expect(gptX?.reasoning).toEqual(
      resolveReasoning({ id: "gpt-x", label: "GPT X" }),
    );
    expect(byKey.has("kody:off")).toBe(false);
  });

  it("keeps custom models in input order", () => {
    const list = buildAgentList(true, true, true, [
      model({ id: "a", automatic: true }),
      model({ id: "b", automatic: true }),
    ]);
    expect(list.map((entry) => entry.key)).toEqual([
      "kody-live-fly",
      "brain-fly",
      "kody:automatic",
      "kody:a",
      "kody:b",
    ]);
  });

  it("offers Automatic only when at least two selected enabled models can form a queue", () => {
    expect(
      buildAgentList(false, false, false, [model({ id: "only" })]).some(
        (entry) => entry.key === "kody:automatic",
      ),
    ).toBe(false);

    expect(
      buildAgentList(false, false, false, [
        model({ id: "first", automatic: true }),
        model({ id: "not-selected" }),
        model({ id: "disabled", enabled: false, automatic: true }),
        model({ id: "second", automatic: true }),
      ]).find((entry) => entry.key === "kody:automatic"),
    ).toMatchObject({
      agentId: "kody",
      modelId: "automatic",
      name: "Automatic",
      reasoning: null,
    });
  });

  it("does not add a built-in Claude row even when a custom model uses Claude", () => {
    const keys = buildAgentList(true, true, true, [
      model({ id: "claude-y", label: "Claude Y" }),
    ]).map((entry) => entry.key);
    expect(keys).toEqual(["kody-live-fly", "brain-fly", "kody:claude-y"]);
  });
});
