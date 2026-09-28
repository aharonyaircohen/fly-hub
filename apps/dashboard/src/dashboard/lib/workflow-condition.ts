export type FriendlyResultStatus =
  "pass" | "fail" | "blocked" | "changed" | "noop";

export const FRIENDLY_RESULT_STATUSES: ReadonlyArray<{
  value: FriendlyResultStatus;
  label: string;
}> = [
  { value: "pass", label: "succeeds" },
  { value: "fail", label: "fails" },
  { value: "blocked", label: "is blocked" },
  { value: "changed", label: "makes a change" },
  { value: "noop", label: "makes no change" },
];

export type FriendlyCondition =
  | { kind: "status"; status: FriendlyResultStatus }
  | { kind: "advanced"; when: Record<string, unknown> };

const STATUS_SET = new Set<FriendlyResultStatus>(
  FRIENDLY_RESULT_STATUSES.map(({ value }) => value),
);

export function isFriendlyResultStatus(
  value: unknown,
): value is FriendlyResultStatus {
  return (
    typeof value === "string" && STATUS_SET.has(value as FriendlyResultStatus)
  );
}

export function conditionFromFriendlySelection(
  status: FriendlyResultStatus,
): Record<string, unknown> {
  return { "result.status": status };
}

export function friendlyConditionFromWhen(
  when?: Record<string, unknown>,
): FriendlyCondition {
  const entries = Object.entries(when ?? {});
  if (entries.length === 1 && entries[0]?.[0] === "result.status") {
    const status = entries[0][1];
    if (isFriendlyResultStatus(status)) return { kind: "status", status };
  }
  return { kind: "advanced", when: when ?? {} };
}

export function friendlyDecisionQuestion(
  when?: Record<string, unknown>,
): string {
  const condition = friendlyConditionFromWhen(when);
  if (condition.kind === "status") {
    switch (condition.status) {
      case "pass":
        return "Did this step succeed?";
      case "fail":
        return "Did this step fail?";
      case "blocked":
        return "Did this step get blocked?";
      case "changed":
        return "Did this step make a change?";
      case "noop":
        return "Did this step make no change?";
    }
  }
  return "Does this step match the rule?";
}

export function friendlyStatusLabel(status: FriendlyResultStatus): string {
  return (
    FRIENDLY_RESULT_STATUSES.find((option) => option.value === status)?.label ??
    status
  );
}
