import { describe, expect, it } from "vitest";

import { verifyQualityResult } from "@dashboard/features/quality/server/quality-result";

const journeys = [
  {
    slug: "sign-in",
    name: "Sign in",
    actions: [{ slug: "enter-token", name: "Enter token" }],
  },
  {
    slug: "send-message",
    name: "Send message",
    actions: [{ slug: "send-fresh-message", name: "Send fresh message" }],
  },
];

describe("verifyQualityResult", () => {
  it("verifies Journey and Action evidence in the saved order", () => {
    const verification = verifyQualityResult(
      {
        journeyResults: journeys.map((journey, index) => ({
          journeySlug: `runner-${journey.slug}`,
          journeyName: `Runner ${journey.name}`,
          status: "passed",
          evidence: `${journey.name} visibly completed.`,
          issueSource: "none",
          cause: "The Journey completed as expected.",
          correction: "No correction is needed.",
          artifactPath: `test-results/quality-runs/run-1/0${index + 1}-${journey.slug}.png`,
        })),
        actionResults: journeys.map((journey, index) => ({
          journeySlug: `runner-${journey.slug}`,
          actionSlug: `runner-${journey.actions[0]!.slug}`,
          actionName: `Runner ${journey.actions[0]!.name}`,
          status: "passed",
          evidence: `${journey.actions[0]!.name} visibly completed.`,
          issueSource: "none",
          cause: "The Action completed as expected.",
          correction: "No correction is needed.",
          artifactPath: `test-results/quality-runs/run-1/action-${index + 1}.png`,
        })),
        scenarioResult: {
          status: "passed",
          evidence: "The complete Scenario passed.",
          issueSource: "none",
          cause: "Every expected result was visible.",
          correction: "No correction is needed.",
          artifactPath: "test-results/quality-runs/run-1/final.png",
        },
      },
      "run-1",
      journeys,
    );

    expect(verification.error).toBeNull();
    expect(verification.result).toMatchObject({
      status: "passed",
      passed: 2,
      failed: 0,
      blocked: 0,
      journeyResults: [
        { journeySlug: "sign-in", journeyName: "Sign in" },
        { journeySlug: "send-message", journeyName: "Send message" },
      ],
      actionResults: [
        { journeySlug: "sign-in", actionSlug: "enter-token" },
        { journeySlug: "send-message", actionSlug: "send-fresh-message" },
      ],
    });
  });

  it("rejects Journey evidence from another run", () => {
    const verification = verifyQualityResult(
      {
        journeyResults: [
          {
            journeySlug: "sign-in",
            journeyName: "Sign in",
            status: "passed",
            evidence: "Sign in completed.",
            artifactPath: "test-results/quality-runs/old-run/sign-in.png",
          },
        ],
        actionResults: [
          {
            journeySlug: "sign-in",
            actionSlug: "enter-token",
            actionName: "Enter token",
            status: "passed",
            evidence: "Token was accepted.",
            artifactPath: "test-results/quality-runs/run-1/action.png",
          },
        ],
        scenarioResult: {
          status: "passed",
          evidence: "Scenario passed.",
          artifactPath: "test-results/quality-runs/run-1/final.png",
        },
      },
      "run-1",
      [journeys[0]!],
    );

    expect(verification.result).toBeNull();
    expect(verification.error).toMatch(/Journey 1 is not inside this run/i);
  });
});
