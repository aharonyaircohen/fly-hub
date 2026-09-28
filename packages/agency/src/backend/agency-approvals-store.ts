import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export type AgencyApprovalScopeKind =
  | "loop"
  | "pipeline"
  | "workflow"
  | "capability";

export type StoredAgencyApproval = {
  approvalId: string;
  scopeKind: AgencyApprovalScopeKind;
  scopeId: string;
  action: string;
  status: "available" | "consumed" | "revoked";
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
  consumedAt?: string;
  dispatchKey?: string;
};

function tenantIdFor(owner: string, repo: string): string {
  const tenantId = `${owner.trim()}/${repo.trim()}`;
  if (!/^[^/\s]+\/[^/\s]+$/.test(tenantId)) {
    throw new Error("Invalid tenant repository");
  }
  return tenantId;
}

export async function listStoredAgencyApprovals(input: {
  owner: string;
  repo: string;
  scopeKind?: AgencyApprovalScopeKind;
  scopeId?: string;
  limit: number;
}): Promise<StoredAgencyApproval[]> {
  return (await createBackendClient().query(backendApi.agencyModel.listApprovals, {
    tenantId: tenantIdFor(input.owner, input.repo),
    ...(input.scopeKind ? { scopeKind: input.scopeKind } : {}),
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    limit: input.limit,
  })) as StoredAgencyApproval[];
}

export async function grantStoredAgencyApproval(input: {
  owner: string;
  repo: string;
  approvalId: string;
  scopeKind: AgencyApprovalScopeKind;
  scopeId: string;
  action: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt?: string;
}): Promise<void> {
  await createBackendClient().mutation(backendApi.agencyModel.grantApproval, {
    tenantId: tenantIdFor(input.owner, input.repo),
    approvalId: input.approvalId,
    scopeKind: input.scopeKind,
    scopeId: input.scopeId,
    action: input.action,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  });
}

export async function consumeStoredAgencyApproval(input: {
  owner: string;
  repo: string;
  approvalId: string;
  scopeKind: AgencyApprovalScopeKind;
  scopeId: string;
  action: string;
  approvedBy: string;
  dispatchKey: string;
  consumedAt: string;
}): Promise<boolean> {
  return await createBackendClient().mutation(
    backendApi.agencyModel.consumeApproval,
    {
      tenantId: tenantIdFor(input.owner, input.repo),
      approvalId: input.approvalId,
      scopeKind: input.scopeKind,
      scopeId: input.scopeId,
      action: input.action,
      approvedBy: input.approvedBy,
      dispatchKey: input.dispatchKey,
      consumedAt: input.consumedAt,
    },
  );
}

export async function revokeStoredAgencyApproval(input: {
  owner: string;
  repo: string;
  approvalId: string;
}): Promise<void> {
  await createBackendClient().mutation(backendApi.agencyModel.revokeApproval, {
    tenantId: tenantIdFor(input.owner, input.repo),
    approvalId: input.approvalId,
  });
}
