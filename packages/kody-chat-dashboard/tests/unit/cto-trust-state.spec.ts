/**
 * Tests for the capability-keyed trust ledger (`trust-state.ts`). Trust is whole-capability
 * (one mode + streak per capability slug, no action dimension). Contracts:
 *   - sibling capabilities of one agentIdentity stay independent;
 *   - approve bumps the streak and graduates at the threshold; reject zeroes +
 *     de-graduates; dismiss is neutral;
 *   - operator overrides (reset/graduate/degrade) are pure + immutable and work
 *     from scratch (graduate a capability with no history);
 *   - parse/serialize round-trips plain JSON;
 *   - summarizeTrust emits one row per roster capability (so its toggle is always
 *     present) even with zero history.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_TRUST_MANIFEST,
  TRUST_GRADUATION_THRESHOLD,
  applySubjectTrustOp,
  applySubjectTrustLevel,
  applyCapabilityTrustLevel,
  applyTrustDecision,
  applyTrustOp,
  degradeCapability,
  graduateCapability,
  isGraduated,
  latestTrustDecisions,
  parseTrustManifest,
  resetCapability,
  serializeTrustManifest,
  summarizeTrust,
  trustDecisionKey,
  trustLevelForCapability,
  trustLevelForSubject,
  trustSubjectKey,
  type TrustManifest,
} from "../../src/dashboard/lib/cto/trust-state";

function approvals(capability: string, n: number): TrustManifest {
  let m: TrustManifest = structuredClone(EMPTY_TRUST_MANIFEST);
  for (let i = 0; i < n; i++) {
    m = applyTrustDecision(m, {
      capability,
      decision: "approve",
      taskNumber: 100 + i,
    });
  }
  return m;
}

describe("applyTrustDecision — whole-capability keying", () => {
  it("keeps sibling capabilities of the same agentIdentity independent", () => {
    const m = approvals("qa-sweep", 10);
    expect(isGraduated(m, "qa-sweep")).toBe(true);
    expect(isGraduated(m, "qa-verify")).toBe(false);
  });

  it("graduates at the threshold and de-graduates on a reject", () => {
    const m = approvals("qa", TRUST_GRADUATION_THRESHOLD);
    expect(m.capabilities.qa.mode).toBe("auto");
    const after = applyTrustDecision(m, {
      capability: "qa",
      decision: "reject",
      taskNumber: 999,
    });
    expect(after.capabilities.qa.mode).toBe("ask");
    expect(after.capabilities.qa.level).toBe("approval-required");
    expect(after.capabilities.qa.consecutiveApprovals).toBe(0);
  });

  it("dismiss is neutral (logs, no stat change) and keeps the action for display", () => {
    const m = approvals("qa", 3);
    const after = applyTrustDecision(m, {
      capability: "qa",
      decision: "dismiss",
      taskNumber: 7,
      action: "fix",
    });
    expect(after.capabilities.qa.consecutiveApprovals).toBe(3);
    expect(after.log.at(-1)?.action).toBe("fix");
  });
});

describe("operator overrides", () => {
  it("graduate forces auto from scratch (no prior history)", () => {
    const after = graduateCapability(EMPTY_TRUST_MANIFEST, "qa-sweep");
    expect(after.capabilities["qa-sweep"].mode).toBe("auto");
    expect(after.capabilities["qa-sweep"].consecutiveApprovals).toBe(
      TRUST_GRADUATION_THRESHOLD,
    );
  });

  it("degrade resets to ask; reset wipes; input never mutated", () => {
    const grad = graduateCapability(approvals("qa", 2), "qa");
    expect(degradeCapability(grad, "qa").capabilities.qa.mode).toBe("ask");
    expect(resetCapability(grad, "qa").capabilities.qa).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: 0,
      mode: "ask",
      level: "approval-required",
    });
    const snap = structuredClone(grad);
    applyTrustOp(grad, "degrade", "qa");
    expect(grad).toEqual(snap);
  });

  it("graduate/degrade/reset subject trust independently from capabilities", () => {
    const subject = trustSubjectKey("loop", "daily-web-release-loop");
    const grad = applySubjectTrustOp(EMPTY_TRUST_MANIFEST, "graduate", subject);

    expect(grad.subjects[subject]).toMatchObject({
      mode: "auto",
      level: "can-run",
      consecutiveApprovals: TRUST_GRADUATION_THRESHOLD,
    });
    expect(grad.capabilities).toEqual({});
    expect(
      applySubjectTrustOp(grad, "degrade", subject).subjects[subject],
    ).toMatchObject({
      mode: "ask",
      level: "approval-required",
      consecutiveApprovals: 0,
    });
    expect(
      applySubjectTrustOp(grad, "reset", subject).subjects[subject],
    ).toBeUndefined();
  });

  it("sets the three visible subject trust levels directly", () => {
    const subject = trustSubjectKey("loop", "weekly-check");
    const canRun = applySubjectTrustLevel(
      EMPTY_TRUST_MANIFEST,
      subject,
      "can-run",
    );
    expect(trustLevelForSubject(canRun.subjects[subject])).toBe("can-run");
    expect(canRun.subjects[subject]).toMatchObject({
      mode: "auto",
      consecutiveApprovals: TRUST_GRADUATION_THRESHOLD,
    });

    const autoApproval = applySubjectTrustLevel(
      canRun,
      subject,
      "auto-approval",
    );
    expect(trustLevelForSubject(autoApproval.subjects[subject])).toBe(
      "auto-approval",
    );

    const approvalRequired = applySubjectTrustLevel(
      autoApproval,
      subject,
      "approval-required",
    );
    expect(trustLevelForSubject(approvalRequired.subjects[subject])).toBe(
      "approval-required",
    );
    expect(approvalRequired.subjects[subject].mode).toBe("ask");
  });

  it("keeps capability can-run separate from capability auto-approval", () => {
    const canRun = applyCapabilityTrustLevel(
      EMPTY_TRUST_MANIFEST,
      "release-prepare",
      "can-run",
    );
    const subject = trustSubjectKey("capability", "release-prepare");

    expect(
      trustLevelForCapability(
        canRun.capabilities["release-prepare"],
        canRun.subjects[subject],
      ),
    ).toBe("can-run");
    expect(canRun.subjects[subject].mode).toBe("auto");
    expect(canRun.capabilities["release-prepare"].mode).toBe("ask");

    const autoApproval = applyCapabilityTrustLevel(
      canRun,
      "release-prepare",
      "auto-approval",
    );
    expect(
      trustLevelForCapability(
        autoApproval.capabilities["release-prepare"],
        autoApproval.subjects[subject],
      ),
    ).toBe("auto-approval");
    expect(autoApproval.capabilities["release-prepare"].mode).toBe("auto");
  });
});

describe("parse/serialize", () => {
  it("round-trips a manifest and tolerates junk", () => {
    const m = graduateCapability(approvals("qa", 1), "qa");
    expect(parseTrustManifest(serializeTrustManifest(m))).toEqual(m);
    expect(parseTrustManifest("not json")).toEqual(EMPTY_TRUST_MANIFEST);
    expect(parseTrustManifest(null)).toEqual(EMPTY_TRUST_MANIFEST);
  });

  it("normalizes minimal direct trust config into dashboard stats", () => {
    const parsed = parseTrustManifest(
      JSON.stringify({
        capabilities: { "dev-ci-health": { mode: "auto" } },
        subjects: {
          "loop:daily-web-release-loop": { mode: "auto" },
          "bad subject": { mode: "auto" },
        },
      }),
    );

    expect(parsed.capabilities["dev-ci-health"]).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: TRUST_GRADUATION_THRESHOLD,
      mode: "auto",
      level: "can-run",
    });
    expect(parsed.subjects["loop:daily-web-release-loop"]).toEqual({
      approvals: 0,
      rejections: 0,
      consecutiveApprovals: TRUST_GRADUATION_THRESHOLD,
      mode: "auto",
      level: "can-run",
    });
    expect(parsed.subjects).not.toHaveProperty("bad subject");
  });
});

describe("latestTrustDecisions", () => {
  it("keys the latest verdict by capability+task+action", () => {
    let m = applyTrustDecision(EMPTY_TRUST_MANIFEST, {
      capability: "qa-verify",
      taskNumber: 1574,
      action: "sync",
      decision: "reject",
      at: "2026-01-01T00:00:00.000Z",
    });
    m = applyTrustDecision(m, {
      capability: "qa-verify",
      taskNumber: 1574,
      action: "sync",
      decision: "approve",
      at: "2026-01-02T00:00:00.000Z",
    });

    expect(
      latestTrustDecisions(m)[trustDecisionKey("qa-verify", 1574, "sync")],
    ).toEqual({ decision: "approve", at: "2026-01-02T00:00:00.000Z" });
    expect(
      latestTrustDecisions(m)[trustDecisionKey("cto", 1574, "sync")],
    ).toBeUndefined();
  });
});

describe("summarizeTrust", () => {
  it("emits a row for every roster capability even with no history (toggle always present)", () => {
    const views = summarizeTrust(EMPTY_TRUST_MANIFEST, [
      { slug: "qa-sweep", agent: "qa" },
      { slug: "docs-readme", agent: "tech-writer" },
    ]);
    expect(views).toHaveLength(2);
    const sweep = views.find((v) => v.capability === "qa-sweep")!;
    expect(sweep.agent).toBe("qa");
    expect(sweep.mode).toBe("ask");
    expect(sweep.hasHistory).toBe(false);
  });

  it("computes remaining + progress toward the threshold", () => {
    const [qa] = summarizeTrust(approvals("qa", 4), [
      { slug: "qa", agent: "qa" },
    ]);
    expect(qa.remaining).toBe(TRUST_GRADUATION_THRESHOLD - 4);
    expect(qa.progress).toBeCloseTo(4 / TRUST_GRADUATION_THRESHOLD);
  });
});
