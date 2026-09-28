import { describe, expect, it } from "vitest";

import {
  FRIENDLY_RESULT_STATUSES,
  conditionFromFriendlySelection,
  friendlyConditionFromWhen,
  friendlyDecisionQuestion,
} from "../../src/dashboard/lib/workflow-condition";

describe("workflow condition language", () => {
  it("offers only result statuses in the normal condition picker", () => {
    expect(FRIENDLY_RESULT_STATUSES).toEqual([
      { value: "pass", label: "succeeds" },
      { value: "fail", label: "fails" },
      { value: "blocked", label: "is blocked" },
      { value: "changed", label: "makes a change" },
      { value: "noop", label: "makes no change" },
    ]);
  });

  it("maps a plain result choice to the engine condition without exposing its path", () => {
    expect(conditionFromFriendlySelection("fail")).toEqual({
      "result.status": "fail",
    });
  });

  it("recognizes simple engine conditions when reopening an existing workflow", () => {
    expect(friendlyConditionFromWhen({ "result.status": "pass" })).toEqual({
      kind: "status",
      status: "pass",
    });
  });

  it("keeps unknown conditions available as an explicit advanced rule", () => {
    expect(friendlyConditionFromWhen({ "facts.needsFix": true })).toEqual({
      kind: "advanced",
      when: { "facts.needsFix": true },
    });
  });

  it("uses a user-facing question for the visual decision node", () => {
    expect(friendlyDecisionQuestion({ "result.status": "pass" })).toBe(
      "Did this step succeed?",
    );
    expect(friendlyDecisionQuestion({ "result.status": "fail" })).toBe(
      "Did this step fail?",
    );
    expect(friendlyDecisionQuestion({ "result.status": "blocked" })).toBe(
      "Did this step get blocked?",
    );
    expect(friendlyDecisionQuestion({ "result.status": "changed" })).toBe(
      "Did this step make a change?",
    );
    expect(friendlyDecisionQuestion({ "result.status": "noop" })).toBe(
      "Did this step make no change?",
    );
  });
});
