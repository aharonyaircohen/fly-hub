import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1_000;

export interface WorkflowRunIdentity {
  owner: string;
  repo: string;
  actor: string;
  workflowId: string;
  input: Record<string, unknown>;
}

interface WorkflowApprovalPayload {
  v: 1;
  approvalId: string;
  owner: string;
  repo: string;
  actor: string;
  workflowId: string;
  action: string;
  expiresAt: number;
}

export interface WorkflowApprovalChallenge {
  token: string;
  approvalId: string;
  action: string;
  expiresAt: string;
}

export function canonicalWorkflowInput(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalWorkflowInput).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalWorkflowInput(item)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function workflowRunAction(
  input: Record<string, unknown>,
): string {
  return `run:${createHash("sha256")
    .update(canonicalWorkflowInput(input))
    .digest("base64url")}`;
}

function signature(encodedPayload: string, signingKey: string): string {
  return createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest("base64url");
}

export function createWorkflowApprovalChallenge(
  identity: WorkflowRunIdentity & {
    signingKey: string;
    approvalId?: string;
    now?: number;
    ttlMs?: number;
  },
): WorkflowApprovalChallenge {
  const expiresAt =
    (identity.now ?? Date.now()) + (identity.ttlMs ?? DEFAULT_TTL_MS);
  const payload: WorkflowApprovalPayload = {
    v: 1,
    approvalId: identity.approvalId ?? `approval-${randomUUID()}`,
    owner: identity.owner,
    repo: identity.repo,
    actor: identity.actor,
    workflowId: identity.workflowId,
    action: workflowRunAction(identity.input),
    expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    token: `${encoded}.${signature(encoded, identity.signingKey)}`,
    approvalId: payload.approvalId,
    action: payload.action,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function verifyWorkflowApprovalChallenge(
  identity: WorkflowRunIdentity & {
    signingKey: string;
    token: string;
    now?: number;
  },
): WorkflowApprovalChallenge | null {
  const [encoded, suppliedSignature, extra] = identity.token.split(".");
  if (!encoded || !suppliedSignature || extra) return null;
  const expectedSignature = signature(encoded, identity.signingKey);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as WorkflowApprovalPayload;
    const action = workflowRunAction(identity.input);
    if (
      payload.v !== 1 ||
      !payload.approvalId ||
      payload.owner !== identity.owner ||
      payload.repo !== identity.repo ||
      payload.actor !== identity.actor ||
      payload.workflowId !== identity.workflowId ||
      payload.action !== action ||
      payload.expiresAt < (identity.now ?? Date.now())
    ) {
      return null;
    }
    return {
      token: identity.token,
      approvalId: payload.approvalId,
      action,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  } catch {
    return null;
  }
}
