import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ CTO API ============

/**
 * One-tap operator verdict on a CTO recommendation surfaced in the inbox.
 * `approve` runs the recommended action for dispatchable verbs
 * (`execute`/`fix`); non-dispatchable verbs are recorded only. Verdicts are
 * tallied in the capability trust ledger that drives graduation.
 */
export const ctoApi = {
  decide: async (input: {
    /** Emitting agent slug; kept for display and legacy entries. */
    agent?: string;
    /** Emitting capability slug — the trust key (falls back to agent server-side). */
    capability?: string;
    taskNumber: number;
    action?: import("../cto/recommendation").CtoAction;
    decision: "approve" | "reject" | "dismiss";
    actorLogin?: string;
    /** The exact `@kody …` command from the agent's `kody-cmd` line. */
    command?: string;
    /** `owner/repo` of the thread when not the connected repo (merge acts there). */
    repoFullName?: string;
  }): Promise<{
    ok: true;
    executed: boolean;
    agent: string;
    capability: string;
    action: string;
    decision: "approve" | "reject" | "dismiss";
    stats: {
      approvals: number;
      rejections: number;
      consecutiveApprovals: number;
      mode: "ask" | "auto";
    } | null;
  }> => {
    const res = await fetch(`${API_BASE}/cto/decision`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse(res);
  },

  /**
   * Latest verdict per `${capability}:${taskNumber}:${action}` from the trust
   * ledger, carrying the timestamp it was recorded so the inbox can scope the
   * badge to recs that pre-date the decision (a dismiss on yesterday's
   * `sync` rec must not silently dismiss today's fresh one). Used by
   * `verdictFor(capability, taskNumber, action, sinceIso)`.
   */
  decisions: async (): Promise<{
    decided: Record<
      string,
      { decision: "approve" | "reject" | "dismiss"; at: string }
    >;
  }> => {
    const res = await fetch(`${API_BASE}/cto/decision`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Full per-capability trust stats + recent decision log, for the /trust page.
   * `capabilities[<slug>]` holds one whole-capability stats block (no action dimension).
   */
  trust: async (): Promise<{
    capabilities: Record<
      string,
      {
        approvals: number;
        rejections: number;
        consecutiveApprovals: number;
        mode: "ask" | "auto";
        level: import("../cto/trust-state").TrustLevel;
      }
    >;
    subjects: Record<
      import("../cto/trust-state").TrustSubjectKey,
      {
        approvals: number;
        rejections: number;
        consecutiveApprovals: number;
        mode: "ask" | "auto";
        level: import("../cto/trust-state").TrustLevel;
      }
    >;
    log: import("../cto/trust-state").TrustDecisionLogEntry[];
  }> => {
    const res = await fetch(`${API_BASE}/cto/trust`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  /**
   * Apply one operator override to a capability's autonomy (whole capability):
   * `reset` (wipe), `graduate` (force auto now), `degrade` (force ask).
   * Never posts an `@kody` command — it only rewrites trust state.
   */
  setTrust: async (input: {
    capability?: string;
    subject?: import("../cto/trust-state").TrustSubjectKey;
    op?: import("../cto/trust-state").TrustOp;
    level?: import("../cto/trust-state").TrustLevel;
    neverAuto?: boolean;
    actorLogin?: string;
  }): Promise<{
    ok: true;
    capability?: string;
    subject?: import("../cto/trust-state").TrustSubjectKey;
    op?: import("../cto/trust-state").TrustOp;
    level?: import("../cto/trust-state").TrustLevel;
    stats: {
      approvals: number;
      rejections: number;
      consecutiveApprovals: number;
      mode: "ask" | "auto";
      level: import("../cto/trust-state").TrustLevel;
    } | null;
  }> => {
    const res = await fetch(`${API_BASE}/cto/trust`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(input),
    });
    return handleResponse(res);
  },
};
