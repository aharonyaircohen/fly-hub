import { describe, expect, it } from "vitest";

import {
  actionSchema,
  journeySchema,
  qualityRunHealth,
  scenarioRecordSchema,
  scenarioSchema,
} from "../../../src/dashboard/lib/quality/contracts";

const NOW = "2026-08-09T12:00:00.000Z";

describe("quality contracts", () => {
  it("models reusable actions as user outcomes", () => {
    const action = actionSchema.parse({
      slug: "send-message",
      name: "Send a message",
      outcome: "The user sends one chat message.",
      area: "Chat",
      status: "active",
      updatedAt: NOW,
    });

    expect(action.slug).toBe("send-message");
    expect(action.outcome).toBe("The user sends one chat message.");
    expect(action).not.toHaveProperty("steps");
    expect(action).not.toHaveProperty("version");
  });

  it("removes legacy browser steps from saved Action data", () => {
    const action = actionSchema.parse({
      slug: "sign-in",
      name: "Sign in",
      outcome: "The user signs in to the dashboard.",
      area: "Authentication",
      steps: [
        {
          operation: "fill",
          target: "GitHub personal access token",
          valueFrom: "github-test-token",
        },
      ],
      status: "active",
      updatedAt: NOW,
    });

    expect(action).not.toHaveProperty("steps");
    expect(JSON.stringify(action)).not.toContain("ghp_");
  });

  it("keeps a journey as an ordered list of action references", () => {
    const journey = journeySchema.parse({
      slug: "direct-chat-persists",
      name: "Direct chat survives reload",
      goal: "A user can return to a saved direct chat.",
      priority: "critical",
      status: "active",
      actionSlugs: ["open-chat", "send-message", "reload-chat"],
      updatedAt: NOW,
    });

    expect(journey.actionSlugs).toEqual([
      "open-chat",
      "send-message",
      "reload-chat",
    ]);
  });

  it("keeps a scenario as an ordered list of journey references", () => {
    const scenario = scenarioSchema.parse({
      slug: "reply-persists",
      journeySlugs: ["sign-in", "direct-chat-persists"],
      name: "Reply persists after reload",
      kind: "persistence",
      given: "A connected repository and configured direct model.",
      expectedVisible: "The same reply is visible after reload.",
      expectedState: "The conversation and messages remain stored.",
      environmentId: "production",
      status: "active",
      updatedAt: NOW,
    });

    expect(scenario.journeySlugs).toEqual(["sign-in", "direct-chat-persists"]);
    expect(scenario.environmentId).toBe("production");
    expect(scenario).not.toHaveProperty("testId");
  });

  it("reads a legacy single-Journey scenario as a one-item Journey list", () => {
    const scenario = scenarioSchema.parse({
      slug: "legacy-reply-persists",
      journeySlug: "direct-chat-persists",
      name: "Legacy reply persists",
      kind: "persistence",
      given: "A connected repository.",
      expectedVisible: "The reply remains visible.",
      expectedState: "The reply remains stored.",
      environmentId: "production",
      status: "active",
      updatedAt: NOW,
    });

    expect(scenario.journeySlugs).toEqual(["direct-chat-persists"]);
    expect(scenario).not.toHaveProperty("journeySlug");
  });

  it("keeps an older active Scenario readable when its environment is missing", () => {
    const legacy = {
      slug: "legacy-scenario",
      journeySlug: "legacy-journey",
      name: "Legacy scenario",
      kind: "happy",
      given: "The saved record predates repository environments.",
      expectedVisible: "The record remains visible.",
      expectedState: "Nothing is changed while reading.",
      status: "active",
      updatedAt: NOW,
    };

    expect(scenarioRecordSchema.parse(legacy).journeySlugs).toEqual([
      "legacy-journey",
    ]);
    expect(scenarioSchema.safeParse(legacy).success).toBe(false);
  });

  it("marks proof stale when its definition changed after the pass", () => {
    expect(
      qualityRunHealth({
        scenarioStatus: "active",
        scenarioUpdatedAt: "2026-08-09T12:01:00.000Z",
        latestRun: {
          status: "passed",
          definitionUpdatedAt: NOW,
          sourceCommit: "abc123",
        },
        targetCommit: "abc123",
      }),
    ).toBe("stale");
  });

  it("marks proof stale when it targets another source commit", () => {
    expect(
      qualityRunHealth({
        scenarioStatus: "active",
        scenarioUpdatedAt: NOW,
        latestRun: {
          status: "passed",
          definitionUpdatedAt: NOW,
          sourceCommit: "abc123",
        },
        targetCommit: "def456",
      }),
    ).toBe("stale");
  });
});
