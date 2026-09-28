/**
 * @fileType utility
 * @domain kody
 * @pattern capability-trust-ledger
 * @ai-summary The capability-keyed trust ledger — types + pure transforms. Trust is
 *   tracked **per capability** (whole-capability, not per action): one mode + streak per
 *   capability slug. Two capabilities sharing an agent identity earn autonomy independently.
 *
 *     - keyed by capability slug → stats (mode/approvals/rejections/streak);
 *     - stored as a repo-scoped Convex manifest (see `trust-store.ts`);
 *     - read by BOTH the engine (the gate that lets a trusted capability self-dispatch)
 *       and the dashboard (the /trust page), so this shape is a shared contract.
 *
 *   All transforms are pure + immutable. Keep the JSON shape stable across repos.
 */

export const TRUST_MANIFEST_VERSION = 1 as const;

/** Bound the log — it's a recent-activity signal, not an archive. */
export const TRUST_LOG_MAX = 500;

/**
 * Clean approvals a capability needs before it stops asking and the engine lets it
 * self-dispatch. A single reject zeroes the streak and de-graduates it.
 */
export const TRUST_GRADUATION_THRESHOLD = 10;

export type TrustMode = "ask" | "auto";
export const TRUST_LEVELS = [
  "approval-required",
  "can-run",
  "auto-approval",
] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];
export type TrustDecision = "approve" | "reject" | "dismiss";
export type TrustSubjectKind = "loop" | "pipeline" | "workflow" | "capability";
export type TrustSubjectKey = `${TrustSubjectKind}:${string}`;

/** Whole-capability trust stats. */
export interface TrustCapabilityStats {
  approvals: number;
  rejections: number;
  /** Resets to 0 on any reject. Drives graduation. */
  consecutiveApprovals: number;
  /** "ask" until graduated; "auto" lets the engine run the capability without asking. */
  mode: TrustMode;
  /** User-facing trust level for one runnable item. */
  level: TrustLevel;
  /** Pins the item to approval-required even after graduating to auto. */
  neverAuto?: boolean;
}

export interface TrustDecisionLogEntry {
  /** Capability slug whose recommendation this verdict decided. */
  capability: string;
  /** Action verb of the rec — kept for display only; trust is keyed per capability. */
  action?: string;
  decision: TrustDecision;
  taskNumber: number;
  at: string;
  by?: string;
}

export interface TrustManifest {
  version: typeof TRUST_MANIFEST_VERSION;
  /** Trust stats keyed by capability slug. */
  capabilities: Record<string, TrustCapabilityStats>;
  /** Repo-owned autonomy policy for loops and workflows. */
  subjects: Record<TrustSubjectKey, TrustCapabilityStats>;
  log: TrustDecisionLogEntry[];
}

export interface TrustLatestDecision {
  decision: TrustDecision;
  at: string;
}

export const EMPTY_TRUST_MANIFEST: TrustManifest = {
  version: TRUST_MANIFEST_VERSION,
  capabilities: {},
  subjects: {},
  log: [],
};

export function freshStats(): TrustCapabilityStats {
  return {
    approvals: 0,
    rejections: 0,
    consecutiveApprovals: 0,
    mode: "ask",
    level: "approval-required",
  };
}

function withStats(
  manifest: TrustManifest,
  capability: string,
  stats: TrustCapabilityStats,
): TrustManifest {
  return {
    ...manifest,
    capabilities: { ...manifest.capabilities, [capability]: stats },
  };
}

function withSubjectStats(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
  stats: TrustCapabilityStats,
): TrustManifest {
  return {
    ...manifest,
    subjects: { ...manifest.subjects, [subject]: stats },
  };
}

export function statsFor(
  manifest: TrustManifest,
  capability: string,
): TrustCapabilityStats {
  return manifest.capabilities[capability] ?? freshStats();
}

export function statsForSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
): TrustCapabilityStats {
  return manifest.subjects[subject] ?? freshStats();
}

export function modeForSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
): TrustMode | null {
  return manifest.subjects[subject]?.mode ?? null;
}

/**
 * Pure: apply an Approve/Reject/Dismiss verdict to a capability, returning a new
 * manifest. Approve bumps the streak (graduating at the threshold); reject
 * zeroes it and de-graduates (kill switch); dismiss is neutral (log only).
 */
export function applyTrustDecision(
  manifest: TrustManifest,
  entry: {
    capability: string;
    decision: TrustDecision;
    taskNumber: number;
    action?: string;
    at?: string;
    by?: string;
  },
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, entry.capability);
  const isApprove = entry.decision === "approve";
  const isReject = entry.decision === "reject";
  const consecutiveApprovals = isApprove
    ? prev.consecutiveApprovals + 1
    : isReject
      ? 0
      : prev.consecutiveApprovals;
  const mode: TrustMode = isReject
    ? "ask"
    : isApprove && consecutiveApprovals >= threshold
      ? "auto"
      : prev.mode;
  const level: TrustLevel = isReject
    ? "approval-required"
    : isApprove && consecutiveApprovals >= threshold
      ? "auto-approval"
      : prev.level;
  const next = withStats(manifest, entry.capability, {
    approvals: prev.approvals + (isApprove ? 1 : 0),
    rejections: prev.rejections + (isReject ? 1 : 0),
    consecutiveApprovals,
    mode,
    level,
  });
  const logEntry: TrustDecisionLogEntry = {
    capability: entry.capability,
    decision: entry.decision,
    taskNumber: entry.taskNumber,
    at: entry.at ?? new Date().toISOString(),
    ...(entry.action ? { action: entry.action } : {}),
    ...(entry.by ? { by: entry.by } : {}),
  };
  return { ...next, log: [...manifest.log, logEntry].slice(-TRUST_LOG_MAX) };
}

export function trustDecisionKey(
  capability: string,
  taskNumber: number,
  action: string,
): string {
  return `${capability}:${taskNumber}:${action}`;
}

export function latestTrustDecisions(
  manifest: TrustManifest,
): Record<string, TrustLatestDecision> {
  const out: Record<string, TrustLatestDecision> = {};
  for (const e of manifest.log) {
    if (!e.action) continue;
    out[trustDecisionKey(e.capability, e.taskNumber, e.action)] = {
      decision: e.decision,
      at: e.at,
    };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator overrides (the /trust page buttons) — pure
// ─────────────────────────────────────────────────────────────────────────────

export const TRUST_OPS = ["reset", "graduate", "degrade", "earn"] as const;
export type TrustOp = (typeof TRUST_OPS)[number];

/** Wipe a capability's trust back to zero / "ask". */
export function resetCapability(
  manifest: TrustManifest,
  capability: string,
): TrustManifest {
  return withStats(manifest, capability, freshStats());
}

/**
 * Instant grant — force a capability to "auto" now. Lifts the streak to the threshold
 * so the engine (which gates on `consecutiveApprovals`) agrees. Totals kept.
 */
export function graduateCapability(
  manifest: TrustManifest,
  capability: string,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsFor(manifest, capability);
  return withStats(manifest, capability, {
    ...prev,
    mode: "auto",
    level: "auto-approval",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

/** Manual kill switch — back to "ask", streak zeroed. Totals kept. */
export function degradeCapability(
  manifest: TrustManifest,
  capability: string,
): TrustManifest {
  const prev = statsFor(manifest, capability);
  return withStats(manifest, capability, {
    ...prev,
    mode: "ask",
    level: "approval-required",
    consecutiveApprovals: 0,
  });
}

/**
 * Back to the default earning path — asks now, keeps the earned streak and
 * totals, and lifts a neverAuto pin. Unlike `degrade` this is non-destructive:
 * the capability resumes graduating from where it left off.
 */
export function earnCapability(
  manifest: TrustManifest,
  capability: string,
): TrustManifest {
  const prev = statsFor(manifest, capability);
  const { neverAuto: _pin, ...rest } = prev;
  return withStats(manifest, capability, {
    ...rest,
    mode: "ask",
    level: "approval-required",
  });
}

export function applyTrustOp(
  manifest: TrustManifest,
  op: TrustOp,
  capability: string,
): TrustManifest {
  switch (op) {
    case "reset":
      return resetCapability(manifest, capability);
    case "graduate":
      return graduateCapability(manifest, capability);
    case "degrade":
      return degradeCapability(manifest, capability);
    case "earn":
      return earnCapability(manifest, capability);
  }
}

export function graduateSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustManifest {
  const prev = statsForSubject(manifest, subject);
  return withSubjectStats(manifest, subject, {
    ...prev,
    mode: "auto",
    level: "can-run",
    consecutiveApprovals: Math.max(prev.consecutiveApprovals, threshold),
  });
}

export function degradeSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
): TrustManifest {
  const prev = statsForSubject(manifest, subject);
  return withSubjectStats(manifest, subject, {
    ...prev,
    mode: "ask",
    level: "approval-required",
    consecutiveApprovals: 0,
  });
}

export function resetSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
): TrustManifest {
  const { [subject]: _removed, ...subjects } = manifest.subjects;
  return { ...manifest, subjects };
}

/** Subject twin of `earnCapability` — ask now, streak and totals kept, pin lifted. */
export function earnSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
): TrustManifest {
  const prev = statsForSubject(manifest, subject);
  const { neverAuto: _pin, ...rest } = prev;
  return withSubjectStats(manifest, subject, {
    ...rest,
    mode: "ask",
    level: "approval-required",
  });
}

export function applySubjectTrustOp(
  manifest: TrustManifest,
  op: TrustOp,
  subject: TrustSubjectKey,
): TrustManifest {
  switch (op) {
    case "reset":
      return resetSubject(manifest, subject);
    case "graduate":
      return graduateSubject(manifest, subject);
    case "degrade":
      return degradeSubject(manifest, subject);
    case "earn":
      return earnSubject(manifest, subject);
  }
}

export function statsForTrustLevel(
  previous: TrustCapabilityStats | undefined,
  level: TrustLevel,
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustCapabilityStats {
  const prev = previous ?? freshStats();
  const canRun = level !== "approval-required";
  return {
    ...prev,
    mode: canRun ? "auto" : "ask",
    level,
    consecutiveApprovals: canRun
      ? Math.max(prev.consecutiveApprovals, threshold)
      : 0,
  };
}

export function applySubjectTrustLevel(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
  level: TrustLevel,
): TrustManifest {
  return withSubjectStats(
    manifest,
    subject,
    statsForTrustLevel(manifest.subjects[subject], level),
  );
}

export function applyCapabilityTrustLevel(
  manifest: TrustManifest,
  capability: string,
  level: TrustLevel,
): TrustManifest {
  const subject = trustSubjectKey("capability", capability);
  const next = applySubjectTrustLevel(manifest, subject, level);
  const capabilityLevel =
    level === "auto-approval" ? "auto-approval" : "approval-required";
  return withStats(
    next,
    capability,
    statsForTrustLevel(next.capabilities[capability], capabilityLevel),
  );
}

export function trustLevelForSubject(
  stats: TrustCapabilityStats | null | undefined,
  fallbackCanRun = false,
): TrustLevel {
  if (stats?.level) return stats.level;
  if (stats?.mode === "auto" || fallbackCanRun) return "can-run";
  return "approval-required";
}

export type AutomationEligibility =
  { eligible: true } | { eligible: false; reason: "approval-required" };

/** Shared policy used by every UI and API boundary that enables automation. */
export function automationEligibilityForSubject(
  manifest: TrustManifest,
  subject: TrustSubjectKey,
  fallbackCanRun = false,
): AutomationEligibility {
  const level = trustLevelForSubject(
    manifest.subjects[subject],
    fallbackCanRun,
  );
  return level === "approval-required"
    ? { eligible: false, reason: "approval-required" }
    : { eligible: true };
}

export function trustLevelForCapability(
  capabilityStats: TrustCapabilityStats | null | undefined,
  subjectStats: TrustCapabilityStats | null | undefined,
): TrustLevel {
  if (subjectStats?.level) return subjectStats.level;
  if (capabilityStats?.level === "auto-approval") return "auto-approval";
  if (capabilityStats?.mode === "auto") return "auto-approval";
  if (subjectStats?.mode === "auto") return "can-run";
  return "approval-required";
}

/** Pin or unpin a capability (and its subject entry) to approval-required. */
export function applyCapabilityNeverAuto(
  manifest: TrustManifest,
  capability: string,
  neverAuto: boolean,
): TrustManifest {
  const subject = trustSubjectKey("capability", capability);
  const withCapability = withStats(manifest, capability, {
    ...statsFor(manifest, capability),
    neverAuto,
  });
  return withSubjectStats(withCapability, subject, {
    ...statsForSubject(withCapability, subject),
    neverAuto,
  });
}

/** True when the engine may let this capability self-dispatch. */
export function isGraduated(
  manifest: TrustManifest,
  capability: string,
): boolean {
  return manifest.capabilities[capability]?.mode === "auto";
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse / serialize — plain JSON file (no issue-body sentinels)
// ─────────────────────────────────────────────────────────────────────────────

export function parseTrustManifest(
  raw: string | null | undefined,
): TrustManifest {
  if (!raw) return structuredClone(EMPTY_TRUST_MANIFEST);
  try {
    const parsed = JSON.parse(raw) as {
      capabilities?: Record<string, Partial<TrustCapabilityStats>>;
      subjects?: Record<string, Partial<TrustCapabilityStats>>;
      log?: Array<Partial<TrustDecisionLogEntry> & { capability?: string }>;
    };
    const capabilities =
      parsed.capabilities && typeof parsed.capabilities === "object"
        ? Object.fromEntries(
            Object.entries(parsed.capabilities).map(([capability, stats]) => [
              capability,
              normalizeStats(stats),
            ]),
          )
        : {};
    const subjects: Record<TrustSubjectKey, TrustCapabilityStats> =
      parsed.subjects && typeof parsed.subjects === "object"
        ? (Object.fromEntries(
            Object.entries(parsed.subjects).flatMap(([subject, stats]) =>
              isTrustSubjectKey(subject)
                ? [[subject, normalizeStats(stats)]]
                : [],
            ),
          ) as Record<TrustSubjectKey, TrustCapabilityStats>)
        : {};
    const log = Array.isArray(parsed.log)
      ? parsed.log.flatMap((entry): TrustDecisionLogEntry[] => {
          const capability = entry.capability;
          if (
            !capability ||
            typeof capability !== "string" ||
            !entry.decision ||
            typeof entry.taskNumber !== "number" ||
            typeof entry.at !== "string"
          ) {
            return [];
          }
          return [
            {
              capability,
              decision: entry.decision,
              taskNumber: entry.taskNumber,
              at: entry.at,
              ...(entry.action ? { action: entry.action } : {}),
              ...(entry.by ? { by: entry.by } : {}),
            },
          ];
        })
      : [];
    return {
      version: TRUST_MANIFEST_VERSION,
      capabilities,
      subjects,
      log,
    };
  } catch {
    return structuredClone(EMPTY_TRUST_MANIFEST);
  }
}

export function trustSubjectKey(
  kind: TrustSubjectKind,
  id: string,
): TrustSubjectKey {
  return `${kind}:${id}` as TrustSubjectKey;
}

export function isTrustSubjectKey(value: string): value is TrustSubjectKey {
  return /^(loop|pipeline|workflow|capability):[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(
    value,
  );
}

function normalizeStats(
  stats: Partial<TrustCapabilityStats> | null | undefined,
): TrustCapabilityStats {
  const mode = stats?.mode === "auto" ? "auto" : "ask";
  const level =
    stats?.level === "auto-approval" ||
    stats?.level === "can-run" ||
    stats?.level === "approval-required"
      ? stats.level
      : mode === "auto"
        ? "can-run"
        : "approval-required";
  const consecutiveApprovals =
    typeof stats?.consecutiveApprovals === "number"
      ? Math.max(0, stats.consecutiveApprovals)
      : mode === "auto"
        ? TRUST_GRADUATION_THRESHOLD
        : 0;

  return {
    approvals:
      typeof stats?.approvals === "number" ? Math.max(0, stats.approvals) : 0,
    rejections:
      typeof stats?.rejections === "number" ? Math.max(0, stats.rejections) : 0,
    consecutiveApprovals,
    mode,
    level,
    ...(stats?.neverAuto === true ? { neverAuto: true } : {}),
  };
}

export function serializeTrustManifest(manifest: TrustManifest): string {
  return JSON.stringify(manifest, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// View model for the /trust page — one row per capability
// ─────────────────────────────────────────────────────────────────────────────

export interface TrustCapabilityView extends TrustCapabilityStats {
  capability: string;
  /** Agent identity the capability runs as (from the roster), or null if unknown. */
  agent: string | null;
  /** Clean approvals still needed to graduate (0 once "auto"). */
  remaining: number;
  /** 0..1 streak progress toward the threshold. */
  progress: number;
  /** True once any verdict has been recorded for this capability. */
  hasHistory: boolean;
}

/** Pair of `(capability slug, agent identity it runs as)` — the only roster fields needed. */
export interface CapabilityStaffLink {
  slug: string;
  agent: string | null;
}

/**
 * Project the manifest + capability roster into one view row per capability: EVERY capability in
 * the roster appears (so its Auto toggle is always available, even with zero
 * history), plus any capability with recorded trust. Pure + deterministic.
 */
export function summarizeTrust(
  manifest: TrustManifest,
  capabilities: readonly CapabilityStaffLink[],
  threshold: number = TRUST_GRADUATION_THRESHOLD,
): TrustCapabilityView[] {
  const staffByCapability = new Map<string, string | null>();
  for (const d of capabilities) staffByCapability.set(d.slug, d.agent);

  const slugs = new Set<string>([
    ...Object.keys(manifest.capabilities),
    ...staffByCapability.keys(),
  ]);

  const views: TrustCapabilityView[] = [...slugs].map((capability) => {
    const stats = manifest.capabilities[capability];
    const s = stats ?? freshStats();
    const remaining =
      s.mode === "auto" ? 0 : Math.max(0, threshold - s.consecutiveApprovals);
    const progress =
      threshold <= 0 ? 1 : Math.min(1, s.consecutiveApprovals / threshold);
    return {
      capability,
      agent: staffByCapability.get(capability) ?? null,
      ...s,
      remaining,
      progress,
      hasHistory: !!stats,
    };
  });

  // Auto capabilities first, then those with history, then alpha.
  return views.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === "auto" ? -1 : 1;
    if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
    return a.capability.localeCompare(b.capability);
  });
}
