import type { LoopDefinition } from "@kody-ade/agency-domain";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";

interface MutationClient {
  mutation(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
}

type SyncInput = {
  owner: string;
  repo: string;
} & (
  { loop: LoopDefinition; loopId?: never } | { loop?: never; loopId: string }
);

export function buildLoopWakeRegistrationArgs(
  input: SyncInput & { updatedAt: string },
): Record<string, unknown> {
  const loopId = input.loop?.id ?? input.loopId;
  if (input.loop?.enabled === true && input.loop.trigger.type === "schedule") {
    return {
      tenantId: `${input.owner}/${input.repo}`,
      loopId,
      enabled: true,
      trigger: input.loop.trigger,
      updatedAt: input.updatedAt,
    };
  }
  return {
    tenantId: `${input.owner}/${input.repo}`,
    loopId,
    enabled: false,
    updatedAt: input.updatedAt,
  };
}

export class LoopWakeSyncError extends Error {
  constructor() {
    super(
      "The definition change was saved, but scheduling did not synchronize. Retry the same change.",
    );
    this.name = "LoopWakeSyncError";
  }
}

export async function syncLoopWakeRegistration(
  input: SyncInput,
  client: MutationClient = createBackendClient(),
): Promise<void> {
  try {
    await client.mutation(
      backendApi.loopWakes.syncRegistration,
      buildLoopWakeRegistrationArgs({
        ...input,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    throw new LoopWakeSyncError();
  }
}
