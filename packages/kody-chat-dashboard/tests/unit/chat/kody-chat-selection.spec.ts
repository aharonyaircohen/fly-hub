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
} from "../../../src/dashboard/lib/chat/platform/agent-entries";
import {
  addLockedModelEntry,
  familySnapEntry,
  resolveDefaultAgentEntry,
  resolveSelectedAgentEntry,
} from "../../../src/dashboard/lib/components/kody-chat-selection";

describe("addLockedModelEntry", () => {
  it("makes a Brand's server-owned model selectable without a user catalog", () => {
    const entries = addLockedModelEntry(list(), "kody", "minimax/MiniMax-M3");

    expect(entries).toContainEqual(
      expect.objectContaining({
        key: "kody:minimax/MiniMax-M3",
        agentId: "kody",
        modelId: "minimax/MiniMax-M3",
      }),
    );
    expect(
      resolveSelectedAgentEntry({
        draftEntryKey: null,
        defaultEntry: null,
        agentList: entries,
        lockedAgentId: "kody",
        lockedModelId: "minimax/MiniMax-M3",
      })?.key,
    ).toBe("kody:minimax/MiniMax-M3");
  });

  it("does not duplicate a locked model already in the catalog", () => {
    const entries = list({
      models: [{ id: "minimax/MiniMax-M3", label: "MiniMax-M3" }],
    });

    expect(
      addLockedModelEntry(entries, "kody", "minimax/MiniMax-M3"),
    ).toBe(entries);
  });
});

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

  it("returns no visible entry when no custom model exists", () => {
    const agentList = list({ brain: true });
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: true,
      agentList,
    });
    expect(entry?.key).toBe("brain");
  });

  it("returns no visible entry when nothing is configured", () => {
    const agentList = list();
    const entry = resolveDefaultAgentEntry({
      chatModels: [],
      brainConfigured: false,
      agentList,
    });
    expect(entry?.key).toBe("kody-live");
  });

  it("does not expose an internal Fly runner as a model", () => {
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
  it("drops old Live keys when there is no visible custom model", () => {
    expect(familySnapEntry("kody-live", list({ fly: true }))?.key).toBe(
      "kody-live-fly",
    );
    expect(familySnapEntry("kody-live-fly", list())?.key).toBe("kody-live");
  });

  it("migrates old Brain keys to the first custom model", () => {
    const models = list({ models: MODELS });
    expect(familySnapEntry("brain-fly", models)).toBeNull();
    expect(familySnapEntry("brain", list())).toBeNull();
  });

  it("snaps a removed gateway model to another custom row or null", () => {
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
  it("uses the saved model for an existing conversation", () => {
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
});
