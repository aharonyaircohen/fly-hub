import { createBackendClient } from "@kody-ade/backend/client";
import { createConvexMemoryStore } from "@kody-ade/backend/memory-store";
import {
  createMemoryApplication,
  type MemoryActor,
  type MemoryPrincipal,
  type MemoryScope,
} from "@kody-ade/memory";

export interface MemoryRuntimeContext {
  readonly actor: Readonly<MemoryActor>;
  readonly tenantId: string;
  readonly includeRepositoryScope?: boolean;
}

export function createMemoryRuntime(
  context: Readonly<MemoryRuntimeContext>,
) {
  const principal: MemoryPrincipal = {
    actor: context.actor,
    tenantIds: [context.tenantId],
  };
  const store = createConvexMemoryStore(createBackendClient(), context);
  const application = createMemoryApplication({
    store,
    nextId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const scopes: readonly MemoryScope[] = [
    ...(context.actor.kind === "user"
      ? [{ kind: "user" as const, userId: context.actor.id }]
      : []),
    ...(context.includeRepositoryScope === false
      ? []
      : [{ kind: "repository" as const, tenantId: context.tenantId }]),
  ];
  return Object.freeze({
    application,
    principal,
    scopes,
    tenantId: context.tenantId,
  });
}
