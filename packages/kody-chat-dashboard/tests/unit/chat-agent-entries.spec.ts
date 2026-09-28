/**
 * Unit tests for the model picker contract.
 *
 * Configured gateway models are shown alongside the internal Live/Brain
 * entries that are part of the chat surface.
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentList,
  type ChatModelEntry,
} from "../../src/dashboard/lib/chat/platform/agent-entries";
import { AGENTS } from "../../src/dashboard/lib/agents";
import {
  FALLBACK_REASONING,
  resolveReasoning,
} from "../../src/dashboard/lib/chat/core/reasoning-adapter";

const model = (
  over: Partial<ChatModelEntry> & { id: string },
): ChatModelEntry => ({
  label: over.id,
  ...over,
});

describe("buildAgentList", () => {
  it("keeps the Live and Brain entries available without custom models", () => {
    expect(
      buildAgentList(false, false, false, []).map((entry) => entry.key),
    ).toEqual(["kody-live"]);
    expect(
      buildAgentList(true, true, true, []).map((entry) => entry.key),
    ).toEqual(["kody-live-fly", "brain-fly"]);
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

    const automatic = buildAgentList(false, false, false, [
      model({ id: "first", automatic: true }),
      model({ id: "not-selected" }),
      model({ id: "disabled", enabled: false, automatic: true }),
      model({ id: "second", automatic: true }),
    ]).find((entry) => entry.key === "kody:automatic");

    expect(automatic).toMatchObject({
      agentId: "kody",
      modelId: "automatic",
      name: "Automatic",
      description: "Uses selected models in order when rate limited",
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
