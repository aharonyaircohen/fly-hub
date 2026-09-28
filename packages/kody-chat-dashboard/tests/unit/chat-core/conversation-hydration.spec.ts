import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../../../src/dashboard/lib/chat-types";
import {
  mergeHydratedSessions,
  preferredHydratedSessionId,
  preserveActiveSessionId,
  shouldLoadHydratedSessionDetail,
  shouldShowConversationSession,
} from "../../../src/dashboard/lib/chat/core/conversation/use-conversation-sessions";

function session(id: string, updatedAt: string): SessionMeta {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
    pinned: false,
  };
}

describe("conversation hydration", () => {
  it("keeps sessions created while the initial server list was loading", () => {
    const local = session("local-new", "2026-07-21T00:01:00.000Z");
    const remote = session("remote", "2026-07-21T00:00:00.000Z");

    expect(mergeHydratedSessions([remote], [local])).toEqual([local, remote]);
  });

  it("uses refreshed server metadata without duplicating a known session", () => {
    const stale = session("known", "2026-07-21T00:00:00.000Z");
    const refreshed = session("known", "2026-07-21T00:02:00.000Z");

    expect(mergeHydratedSessions([refreshed], [stale])).toEqual([refreshed]);
  });

  it("keeps a newer local choice when the initial server list contains the same session", () => {
    const remoteBeforeSelection = session(
      "known",
      "2026-07-21T00:00:00.000Z",
    );
    const locallySelected = {
      ...session("known", "2026-07-21T00:02:00.000Z"),
      agentKey: "kody:configured-model",
    };

    expect(
      mergeHydratedSessions([remoteBeforeSelection], [locallySelected]),
    ).toEqual([locallySelected]);
  });

  it("does not load stale detail over a session created during hydration", () => {
    expect(
      shouldLoadHydratedSessionDetail("local-new", new Set(["local-new"])),
    ).toBe(false);
    expect(
      shouldLoadHydratedSessionDetail("remote", new Set(["local-new"])),
    ).toBe(true);
  });

  it("does not replace a conversation the user already activated", () => {
    expect(preserveActiveSessionId("local-new", "remote")).toBe("local-new");
    expect(preserveActiveSessionId("", "remote")).toBe("remote");
  });

  it("hydrates the conversation named by the route when it exists", () => {
    const loaded = [
      session("latest", "2026-07-21T00:02:00.000Z"),
      session("linked", "2026-07-21T00:01:00.000Z"),
    ];

    expect(preferredHydratedSessionId(loaded, "linked")).toBe("linked");
    expect(preferredHydratedSessionId(loaded, "missing")).toBe("latest");
    expect(preferredHydratedSessionId([], "missing")).toBe("");
  });

  it("hides empty non-active drafts from the conversation picker", () => {
    expect(
      shouldShowConversationSession({ id: "empty", messageCount: 0 }, "active"),
    ).toBe(false);
    expect(
      shouldShowConversationSession({ id: "active", messageCount: 0 }, "active"),
    ).toBe(true);
    expect(
      shouldShowConversationSession({ id: "used", messageCount: 2 }, "active"),
    ).toBe(true);
  });
});
