import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

export type BlueprintInstallationStatus = "installing" | "active" | "blocked";

export async function saveBlueprintInstallation(input: {
  owner: string;
  repo: string;
  blueprintId: string;
  blueprintVersion: string;
  status: BlueprintInstallationStatus;
  requestId: string;
  maintainerId?: string;
  evidence?: string[];
}) {
  return createBackendClient().mutation(
    backendApi.blueprintInstallations.save,
    {
      tenantId: `${input.owner}/${input.repo}`,
      blueprintId: input.blueprintId,
      blueprintVersion: input.blueprintVersion,
      status: input.status,
      requestId: input.requestId,
      ...(input.maintainerId ? { maintainerId: input.maintainerId } : {}),
      evidence: input.evidence ?? [],
      updatedAt: new Date().toISOString(),
    },
  );
}
