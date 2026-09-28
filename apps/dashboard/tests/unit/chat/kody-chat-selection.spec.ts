/**
 * Unit coverage for the pure agent-selection decisions extracted in
 * phase 1.6c: the default-entry resolution chain and the family snap
 * for dropdown rows that disappeared from the list.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  buildAgentList,
  type ChatModelEntry,
} from "@kody-ade/kody-chat-dashboard/platform/agent-entries";
import {
  familySnapEntry,
  resolveDefaultAgentEntry,
  resolveSelectedAgentEntry,
} from "@kody-ade/kody-chat-dashboard/components/kody-chat-selection";

const MODELS: ChatModelEntry[] = [
  { id: "claude-sonnet", label: "Claude Sonnet" },
  { id: "gpt-5", label: "GPT-5", default: true },
];

function list(opts?: {
  brain?: boolean;
  fly?: boolean;
  brainFly?: boolean;
  models?: ChatModelEntry[];
}) {
  return buildAgentList(
    opts?.brain ?? false,
    opts?.fly ?? false,
    opts?.brainFly ?? false,
    opts?.models ?? [],
  );
}

describe("resolveDefaultAgentEntry", () => {
  it("uses Automatic when it is the Chat default", () => {
    const models: ChatModelEntry[] = [
      { id: "claude-sonnet", label: "Claude Sonnet", automatic: true },
      { id: "gpt-5", label: "GPT-5", automatic: true },
    ];
    const agentList = list({ models });
    const entry = resolveDefaultAgentEntry({
      chatModels: models,
      automaticDefault: true,
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody:automatic");
  });

  it("uses the configured default model", () => {
    const agentList = list({ models: MODELS, brain: true });
    const entry = resolveDefaultAgentEntry({
      chatModels: MODELS,
      brainConfigured: true,
      agentList,
    });
    expect(entry?.key).toBe("kody:gpt-5");
  });

  it("falls back to the legacy default-flagged model when no saved pick", () => {
    const agentList = list({ models: MODELS });
    const entry = resolveDefaultAgentEntry({
      chatModels: MODELS,
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody:gpt-5");
  });

  it("skips a disabled default-flagged model and uses the first Kody model", () => {
    const models: ChatModelEntry[] = [
      { id: "claude-sonnet", label: "Claude Sonnet" },
      { id: "gpt-5", label: "GPT-5", default: true, enabled: false },
    ];
    const agentList = list({ models });
    const entry = resolveDefaultAgentEntry({
      chatModels: models,
      brainConfigured: false,
      agentList,
    });
    expect(entry?.agentId).toBe("kody");
    expect(entry?.key).toBe("kody:claude-sonnet");
  });

  it("uses Brain when configured and no Kody model exists", () => {
    const agentList = list({ brain: true });
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: true,
      agentList,
    });
    expect(entry?.key).toBe("brain");
  });

  it("falls through to Live when nothing else is configured", () => {
    const agentList = list();
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody-live");
  });

  it("uses Fly Live when the repo is on Fly", () => {
    const agentList = list({ fly: true });
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody-live-fly");
  });

  it("ignores a saved pick that no longer resolves to a row", () => {
    const agentList = list();
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody-live");
  });
});

describe("familySnapEntry", () => {
  it("snaps Live to the available Live variant", () => {
    expect(familySnapEntry("kody-live", list({ fly: true }))?.key).toBe(
      "kody-live-fly",
    );
    expect(familySnapEntry("kody-live-fly", list())?.key).toBe("kody-live");
  });

  it("snaps Brain-Fly to manual Brain when Fly chat is unavailable", () => {
    expect(familySnapEntry("brain-fly", list({ brain: true }))?.key).toBe(
      "brain",
    );
    expect(familySnapEntry("brain", list())).toBeNull();
  });

  it("snaps a removed gateway model to another custom row, then Live", () => {
    const withModel = list({
      models: [{ id: "claude-sonnet", label: "Claude Sonnet" }],
    });
    expect(familySnapEntry("kody:removed", withModel)?.key).toBe(
      "kody:claude-sonnet",
    );
    expect(familySnapEntry("kody:removed", list())?.key).toBe("kody-live");
  });

  it("returns null for keys outside the known families", () => {
    expect(familySnapEntry("something-else", list())).toBeNull();
  });
});

describe("resolveSelectedAgentEntry", () => {
  it("uses an existing conversation's saved model instead of the default", () => {
    const agentList = list({ models: MODELS });
    const defaultEntry = agentList.find((entry) => entry.key === "kody:gpt-5")!;

    expect(
      resolveSelectedAgentEntry({
        activeSessionId: "conversation-1",
        activeSessionAgentKey: "kody:claude-sonnet",
        draftEntryKey: "kody-live",
        defaultEntry,
        agentList,
      })?.key,
    ).toBe("kody:claude-sonnet");
  });

  it("uses draft selection only before a conversation exists", () => {
    const agentList = list({ models: MODELS });
    const defaultEntry = agentList.find((entry) => entry.key === "kody:gpt-5")!;

    expect(
      resolveSelectedAgentEntry({
        activeSessionId: undefined,
        activeSessionAgentKey: undefined,
        draftEntryKey: "kody:claude-sonnet",
        defaultEntry,
        agentList,
      })?.key,
    ).toBe("kody:claude-sonnet");
  });
});
