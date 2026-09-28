import { encodeMemoryCursor, decodeMemoryCursor } from "./memory-cursor";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import { getTriggers, triggerConfigSchema } from "@kody-ade/base/triggers";
import { isSystemEventName } from "@kody-ade/base/events";
import { createLoopDefinition } from "@kody-ade/agency-domain";
import {
  listCapabilityFiles,
  readResolvedCapabilityFile,
} from "@kody-ade/agency/capabilities";
import { splitContextFrontmatter } from "@kody-ade/workspace/context/frontmatter";
import {
  listTodoFiles,
  readTodoFile,
  writeTodoFile,
  type TodoFile,
} from "@kody-ade/workspace/todos/files";
import type { KodyMcpActionServices } from "@kody-ade/kody-chat-dashboard/integration-ts/lib/mcp/catalog";
import { KodyActionError } from "@kody-ade/kody-chat-dashboard/integration-ts/lib/mcp/catalog";
import {
  KODY_MCP_CONTRACT_VERSION,
  type McpPrincipal,
} from "@kody-ade/kody-chat-dashboard/integration-ts/lib/mcp/contracts";
import {
  clearGitHubContext,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import { resolveInstalledCapabilitySlugs } from "@dashboard/lib/company-store/installed-capabilities";
import {
  listCompanyStoreWorkflowDefinitionFiles,
  listWorkflowDefinitionFiles,
} from "@dashboard/lib/workflow-definition-files";
import { createCompanyWorkflowLoader } from "@dashboard/features/workflows/server/company-workflow-loader";
import { effectiveActiveWorkflowIds } from "@dashboard/features/workflows/built-in-workflows";
import { workflowAutomationEligibility } from "@dashboard/features/workflows/server/workflow-execution-authorization";
import {
  validateWorkflowDefinition,
  validateWorkflowInput,
} from "@dashboard/lib/workflow-definitions";
import { normalizeWorkflowDefinition } from "@dashboard/lib/workflow-definitions";
import { normalizePipelineDefinition } from "@dashboard/lib/pipeline-definitions";
import { readTrust } from "@dashboard/lib/cto/trust-store";
import {
  automationEligibilityForSubject,
  trustSubjectKey,
} from "@dashboard/lib/cto/trust-state";
import { createWorkflowApprovalChallenge } from "@kody-ade/agency/workflow-run-approval";
import {
  MemoryAccessDeniedError,
  MemoryConflictError,
  MemoryNotFoundError,
  type EvidenceRef,
} from "@kody-ade/memory";
import { createMemoryRuntime } from "@kody-ade/workspace/memory/runtime";
import { getWorkflowApprovalSigningKey } from "@dashboard/features/workflows/server/workflow-approval-signing-key";
import {
  listRepositoryLoops,
  readRepositoryLoop,
} from "@dashboard/lib/repository-loops";
import { probeWebhookHealth } from "@dashboard/lib/health/webhook-health";
import { readNotificationsManifestFresh } from "@dashboard/lib/notifications-server";
import {
  NotificationCreateRuleInputSchema,
  slugifyRuleName,
} from "@dashboard/lib/notifications";
import {
  appendTodoWork,
  createTodoWork,
  readTodoWork,
  TodoWorkError,
  updateTodoWork,
  workRequestState,
} from "@dashboard/lib/mcp/todo-work";

type WorkflowRecord = Awaited<
  ReturnType<typeof listWorkflowDefinitionFiles>
>[number];

function repository(principal: McpPrincipal) {
  const [owner = "", repo = ""] = principal.tenantId.split("/", 2);
  if (!owner || !repo)
    throw new KodyActionError("invalid_scope", "Repository scope is invalid.");
  return { owner, repo };
}

function hashRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function approvalActor(principal: McpPrincipal) {
  return {
    tokenId: principal.tokenId,
    name: principal.name,
    actorLogin: principal.actorLogin,
    actorGithubId: principal.actorGithubId,
  };
}

function workActor(principal: McpPrincipal) {
  return {
    tokenId: principal.tokenId,
    name: principal.name,
    actorLogin: principal.actorLogin,
  };
}

function workError(error: unknown): never {
  if (error instanceof TodoWorkError) {
    throw new KodyActionError(
      error.code === "conflict" ? "work_conflict" : "invalid_work",
      error.message,
    );
  }
  throw error;
}

function memoryError(error: unknown): never {
  const data =
    error && typeof error === "object" && "data" in error
      ? error.data
      : undefined;
  if (
    data &&
    typeof data === "object" &&
    "code" in data &&
    "message" in data &&
    typeof data.code === "string" &&
    typeof data.message === "string" &&
    [
      "idempotency_conflict",
      "memory_not_found",
      "revision_conflict",
      "invalid_memory_state",
    ].includes(data.code)
  ) {
    throw new KodyActionError(data.code, data.message);
  }
  if (
    error instanceof Error &&
    /only an active memory can be revised/i.test(error.message)
  )
    throw new KodyActionError(
      "invalid_memory_state",
      "Only an active memory can be revised.",
    );
  if (
    error instanceof Error &&
    /memory idempotency conflict/i.test(error.message)
  )
    throw new KodyActionError(
      "idempotency_conflict",
      "The request key was already used with different input.",
    );
  if (
    error instanceof Error &&
    /memory request result was deleted/i.test(error.message)
  )
    throw new KodyActionError(
      "memory_not_found",
      "The original request result was deleted.",
    );
  if (error instanceof MemoryAccessDeniedError)
    throw new KodyActionError(
      "insufficient_scope",
      "The access token cannot access this memory scope.",
    );
  if (error instanceof MemoryNotFoundError)
    throw new KodyActionError("memory_not_found", "Memory was not found.");
  if (error instanceof MemoryConflictError)
    throw new KodyActionError(
      "revision_conflict",
      "Memory changed since the supplied revision; read it again before retrying.",
    );
  if (
    error instanceof Error &&
    /memory changed since it was read|memory revision already exists/i.test(
      error.message,
    )
  )
    throw new KodyActionError(
      "revision_conflict",
      "Memory changed since the supplied revision; read it again before retrying.",
    );
  if (error instanceof Error && /memory not found/i.test(error.message))
    throw new KodyActionError("memory_not_found", "Memory was not found.");
  throw error;
}

function memoryRuntimeFor(principal: McpPrincipal) {
  return createMemoryRuntime({
    actor: { kind: "user", id: `github:${principal.actorGithubId}` },
    tenantId: principal.tenantId,
  });
}

function memoryScopes(
  runtime: ReturnType<typeof memoryRuntimeFor>,
  scope: unknown,
) {
  if (scope === "personal")
    return runtime.scopes.filter((item) => item.kind === "user");
  if (scope === "user")
    return runtime.scopes.filter((item) => item.kind === "user");
  if (scope === "repository")
    return runtime.scopes.filter((item) => item.kind === "repository");
  return runtime.scopes;
}

function requireMemoryGrant(
  principal: McpPrincipal,
  scope: "user" | "repository",
  operation: "read" | "write" | "delete",
) {
  const grantScope = scope === "user" ? "personal" : scope;
  const grant = `memory:${grantScope}:${operation}`;
  if (!principal.scopes.includes(grant)) {
    throw new KodyActionError(
      "insufficient_scope",
      `The access token cannot ${operation} ${scope} memory.`,
    );
  }
}

function memoryEvidence(id: string, supplied: unknown) {
  return [
    { source: "conversation" as const, id },
    ...((Array.isArray(supplied) ? supplied : []) as EvidenceRef[]),
  ];
}

function memoryWriteRequest(
  input: Record<string, unknown>,
  principal: McpPrincipal,
) {
  const { idempotencyKey, ...payload } = input;
  return {
    key: hashRequest({ connection: principal.tokenId, key: idempotencyKey }),
    hash: hashRequest(payload),
  };
}

function writeWorkTodo(
  todo: TodoFile,
  octokit: Octokit,
  expectedUpdatedAt: string | null,
) {
  return writeTodoFile({
    octokit,
    slug: todo.slug,
    title: todo.title,
    description: todo.description,
    items: todo.items,
    createdAt: todo.createdAt,
    frontmatter: todo.frontmatter,
    expectedUpdatedAt,
    message: `chore(todos): update MCP work ${todo.slug}`,
  });
}

async function withRepository<T>(
  principal: McpPrincipal,
  operation: (context: {
    owner: string;
    repo: string;
    octokit: Octokit;
  }) => Promise<T>,
): Promise<T> {
  const { owner, repo } = repository(principal);
  const background = await resolveBackgroundToken(owner, repo);
  if (!background)
    throw new KodyActionError(
      "repository_access_unavailable",
      "Repository access is not configured.",
    );
  const octokit = new Octokit({ auth: background.token });
  setGitHubContext(owner, repo, background.token);
  try {
    return await operation({ owner, repo, octokit });
  } finally {
    clearGitHubContext();
  }
}

async function requireWorkTodo(principal: McpPrincipal, recordId: string) {
  await withRepository(principal, async ({ octokit }) => {
    const todo = await readTodoFile(recordId, octokit);
    if (!todo)
      throw new KodyActionError(
        "work_not_found",
        "Create MCP work in Todos before requesting execution.",
      );
    try {
      readTodoWork(todo, principal.tenantId);
    } catch (error) {
      workError(error);
    }
  });
}

async function listWorkflowRecords(principal: McpPrincipal): Promise<
  Array<
    WorkflowRecord & {
      automation:
        { eligible: true } | { eligible: false; reason: "approval-required" };
    }
  >
> {
  return await withRepository(principal, async ({ owner, repo, octokit }) => {
    const local = await listWorkflowDefinitionFiles(owner, repo);
    const { config } = await getEngineConfig(octokit, owner, repo);
    const active = effectiveActiveWorkflowIds(config.company?.activeWorkflows);
    const localIds = new Set(local.map((item) => item.id));
    const store = active.size
      ? (await listCompanyStoreWorkflowDefinitionFiles(octokit)).filter(
          (item) => active.has(item.id) && !localIds.has(item.id),
        )
      : [];
    const workflows = [...local, ...store].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const eligibility = await workflowAutomationEligibility(workflows);
    return workflows.map((item) => ({
      ...item,
      automation: eligibility.get(item.id) ?? {
        eligible: false,
        reason: "approval-required" as const,
      },
    }));
  });
}

async function createApprovalRequest(
  principal: McpPrincipal,
  input: {
    workRecordId: string;
    targetKind: "workflow" | "capability" | "automation";
    targetId: string;
    runId: string;
    mode: "start" | "resume";
    approvalId: string;
    approvalToken: string;
    action: string;
    approvalInput: Record<string, unknown>;
    idempotencyKey: string;
  },
) {
  await requireWorkTodo(principal, input.workRecordId);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const requestId = `request-${randomUUID()}`;
  const stored = await createBackendClient().mutation(
    backendApi.mcpApprovalRequests.create,
    {
      tenantId: principal.tenantId,
      requestId,
      workRecordId: input.workRecordId,
      targetKind: input.targetKind,
      workflowId: input.targetId,
      runId: input.runId,
      mode: input.mode,
      input: input.approvalInput,
      action: input.action,
      approvalId: input.approvalId,
      approvalToken: input.approvalToken,
      actor: approvalActor(principal),
      idempotencyKey: input.idempotencyKey,
      requestHash: hashRequest({
        targetKind: input.targetKind,
        targetId: input.targetId,
        runId: input.runId,
        mode: input.mode,
        approvalInput: input.approvalInput,
      }),
      createdAt,
      expiresAt,
    },
  );
  return {
    ...stored,
    approvalUrl: `/repo/${repository(principal).owner}/${repository(principal).repo}/todos/${input.workRecordId}`,
  };
}

export function createKodyMcpActionServices({
  origin,
}: {
  origin: string;
}): KodyMcpActionServices {
  return {
    async listMemories(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      const scopes = memoryScopes(runtime, input.scope);
      for (const scope of scopes)
        requireMemoryGrant(principal, scope.kind, "read");
      try {
        const binding = hashRequest({
          tenant: principal.tenantId,
          actor: principal.actorGithubId,
          scopes,
        });
        const key = process.env.KODY_SERVICE_KEY ?? "";
        let state = { binding, index: 0, cursor: null as string | null };
        if (input.cursor) {
          try {
            state = decodeMemoryCursor(String(input.cursor), binding, key);
          } catch {
            throw new KodyActionError(
              "invalid_cursor",
              "The memory cursor is invalid for this scope.",
            );
          }
        }
        if (state.index >= scopes.length)
          throw new KodyActionError(
            "invalid_cursor",
            "Memory cursor position is invalid.",
          );
        const memories: Array<
          Awaited<ReturnType<typeof runtime.application.page>>["page"][number]
        > = [];
        const limit = Number(input.limit ?? 20);
        while (state.index < scopes.length && memories.length < limit) {
          const page = await runtime.application.page({
            principal: runtime.principal,
            scopes,
            scope: scopes[state.index],
            cursor: state.cursor,
            limit: limit - memories.length,
          });
          memories.push(...page.page);
          state = {
            binding,
            index: page.isDone ? state.index + 1 : state.index,
            cursor: page.isDone ? null : page.continueCursor,
          };
          if (!page.isDone) break;
        }
        const nextCursor =
          state.index < scopes.length
            ? encodeMemoryCursor(state, key)
            : undefined;
        return { memories, ...(nextCursor ? { nextCursor } : {}) };
      } catch (error) {
        memoryError(error);
      }
    },
    async getMemory(memoryId, principal) {
      const runtime = memoryRuntimeFor(principal);
      try {
        const memory = await runtime.application.get({
          principal: runtime.principal,
          memoryId,
        });
        requireMemoryGrant(principal, memory.scope.kind, "read");
        return { memory };
      } catch (error) {
        memoryError(error);
      }
    },
    async searchMemories(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      const scopes = memoryScopes(runtime, input.scope);
      for (const scope of scopes)
        requireMemoryGrant(principal, scope.kind, "read");
      try {
        const rows = await runtime.application.search({
          principal: runtime.principal,
          scopes,
          query: String(input.query),
          limit: Number(input.limit ?? 10),
        });
        const now = Date.now();
        return {
          items: rows
            .filter(
              (memory) =>
                memory.status === "active" &&
                (!memory.expiresAt || Date.parse(memory.expiresAt) > now),
            )
            .map((memory) => ({
              memoryId: memory.id,
              kind: memory.kind,
              scope: memory.scope,
              title: memory.content.title,
              summary: memory.content.summary,
              body: memory.content.body,
              revisionId: memory.currentRevisionId,
              updatedAt: memory.updatedAt,
              provenance: {
                source: "kody-memory",
                revisionId: memory.currentRevisionId,
              },
            })),
        };
      } catch (error) {
        memoryError(error);
      }
    },
    async getMemoryHistory(memoryId, principal) {
      const runtime = memoryRuntimeFor(principal);
      try {
        const memory = await runtime.application.get({
          principal: runtime.principal,
          memoryId,
        });
        requireMemoryGrant(principal, memory.scope.kind, "read");
        const revisions = await runtime.application.history({
          principal: runtime.principal,
          memoryId,
        });
        return { memoryId, revisions };
      } catch (error) {
        memoryError(error);
      }
    },
    async createMemory(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      const scopeKind =
        String(input.scope) === "personal" ? "user" : "repository";
      requireMemoryGrant(principal, scopeKind, "write");
      const scope =
        scopeKind === "user"
          ? { kind: "user" as const, userId: runtime.principal.actor.id }
          : { kind: "repository" as const, tenantId: principal.tenantId };
      const request = memoryWriteRequest(input, principal);
      const marker = `mcp:${request.key}:${request.hash}`;
      try {
        const memory = await runtime.application.remember({
          request,
          principal: runtime.principal,
          scope,
          kind: input.kind as never,
          content: {
            title: String(input.title),
            summary: String(input.summary),
            body: String(input.body),
          },
          ...(input.expiresAt === undefined
            ? {}
            : { expiresAt: String(input.expiresAt) }),
          evidence: memoryEvidence(marker, input.evidence),
          reason: String(
            input.reason ?? "Saved by a coding agent through Kody MCP.",
          ),
        });
        return { memory };
      } catch (error) {
        memoryError(error);
      }
    },
    async reviseMemory(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      try {
        const current = await runtime.application.get({
          principal: runtime.principal,
          memoryId: String(input.memoryId),
        });
        requireMemoryGrant(principal, current.scope.kind, "write");
        const request = memoryWriteRequest(input, principal);
        const marker = `mcp:${request.key}:${request.hash}`;
        const memory = await runtime.application.correct({
          request,
          principal: runtime.principal,
          memoryId: current.id,
          expectedRevisionId: String(input.expectedRevisionId),
          kind: input.kind as never,
          content: {
            title: String(input.title),
            summary: String(input.summary),
            body: String(input.body),
          },
          ...(input.expiresAt === undefined
            ? {}
            : { expiresAt: String(input.expiresAt) }),
          evidence: memoryEvidence(marker, input.evidence),
          reason: String(
            input.reason ?? "Corrected by a coding agent through Kody MCP.",
          ),
        });
        return { memory };
      } catch (error) {
        memoryError(error);
      }
    },
    async retireMemory(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      try {
        const current = await runtime.application.get({
          principal: runtime.principal,
          memoryId: String(input.memoryId),
        });
        requireMemoryGrant(principal, current.scope.kind, "write");
        const request = memoryWriteRequest(input, principal);
        const marker = `mcp:${request.key}:${request.hash}`;
        const memory = await runtime.application.retire({
          request,
          principal: runtime.principal,
          memoryId: current.id,
          expectedRevisionId: String(input.expectedRevisionId),
          evidence: memoryEvidence(marker, input.evidence),
          reason: String(input.reason),
        });
        return { memory };
      } catch (error) {
        memoryError(error);
      }
    },
    async deleteMemory(input, principal) {
      const runtime = memoryRuntimeFor(principal);
      try {
        try {
          const current = await runtime.application.get({
            principal: runtime.principal,
            memoryId: String(input.memoryId),
          });
          requireMemoryGrant(principal, current.scope.kind, "delete");
        } catch (error) {
          if (!(error instanceof MemoryNotFoundError)) throw error;
          if (
            !principal.scopes.some(
              (scope) =>
                scope === "memory:repository:delete" ||
                scope === "memory:personal:delete",
            )
          )
            throw new KodyActionError(
              "insufficient_scope",
              "The access token cannot delete memories.",
            );
        }
        return await runtime.application.forget({
          principal: runtime.principal,
          memoryId: String(input.memoryId),
          request: memoryWriteRequest(input, principal),
        });
      } catch (error) {
        memoryError(error);
      }
    },
    async listWork(input, principal) {
      return await withRepository(principal, async () => {
        const rows = await listTodoFiles();
        return rows
          .flatMap((todo) => {
            try {
              return [readTodoWork(todo, principal.tenantId).record];
            } catch (error) {
              if (
                error instanceof TodoWorkError &&
                error.code === "invalid_work"
              )
                return [];
              throw error;
            }
          })
          .filter((work) => !input.status || work.status === input.status)
          .slice(0, Number(input.limit));
      });
    },
    async getWork(recordId, principal) {
      return await withRepository(principal, async ({ octokit }) => {
        const todo = await readTodoFile(recordId, octokit);
        if (!todo)
          throw new KodyActionError(
            "work_not_found",
            "MCP work was not found.",
          );
        try {
          return readTodoWork(todo, principal.tenantId);
        } catch (error) {
          workError(error);
        }
      });
    },
    async createWork(input, principal) {
      return await withRepository(principal, async ({ octokit }) => {
        const { idempotencyKey, actionId, ...payload } = input;
        const request = {
          key: String(idempotencyKey),
          hash: hashRequest({ actionId, input: payload }),
        };
        const recordId = String(payload.recordId);
        const existing = await readTodoFile(recordId, octokit);
        if (existing) {
          try {
            if (workRequestState(existing, request) === "replay")
              return readTodoWork(existing, principal.tenantId).record;
          } catch (error) {
            workError(error);
          }
          throw new KodyActionError(
            "work_conflict",
            "A Todo with this work ID already exists.",
          );
        }
        const now = new Date().toISOString();
        const todo = createTodoWork(
          payload,
          workActor(principal),
          request,
          now,
        );
        const saved = await writeWorkTodo(todo, octokit, null);
        return readTodoWork(saved, principal.tenantId).record;
      });
    },
    async appendWork(type, input, principal) {
      return await withRepository(principal, async ({ octokit }) => {
        const {
          recordId,
          expectedRevision,
          idempotencyKey,
          actionId,
          ...payload
        } = input;
        const existing = await readTodoFile(String(recordId), octokit);
        if (!existing)
          throw new KodyActionError(
            "work_not_found",
            "MCP work was not found.",
          );
        const request = {
          key: String(idempotencyKey),
          hash: hashRequest({
            actionId,
            input: { recordId, expectedRevision, ...payload },
          }),
        };
        try {
          const now = new Date().toISOString();
          const next =
            type === "update"
              ? updateTodoWork(
                  existing,
                  { ...payload, expectedRevision },
                  workActor(principal),
                  request,
                  now,
                )
              : appendTodoWork(
                  existing,
                  type,
                  payload,
                  Number(expectedRevision),
                  workActor(principal),
                  request,
                  now,
                );
          if (next === existing)
            return readTodoWork(existing, principal.tenantId).record;
          const saved = await writeWorkTodo(next, octokit, existing.updatedAt);
          return readTodoWork(saved, principal.tenantId).record;
        } catch (error) {
          workError(error);
        }
      });
    },
    async listPolicies(principal) {
      const rows = (await createBackendClient().query(
        backendApi.repoDocs.listByPrefix,
        { tenantId: principal.tenantId, prefix: "policy:" },
      )) as Array<{ kind: string; doc: { body?: unknown }; updatedAt: string }>;
      return rows
        .filter((row) => typeof row.doc.body === "string")
        .map((row) => {
          const parsed = splitContextFrontmatter(String(row.doc.body));
          return {
            id: row.kind.slice("policy:".length),
            body: parsed.body.trim(),
            agents: parsed.frontmatter.agent,
            updatedAt: row.updatedAt,
          };
        });
    },
    async getPolicy(slug, principal) {
      const row = (await createBackendClient().query(backendApi.repoDocs.get, {
        tenantId: principal.tenantId,
        kind: `policy:${slug}`,
      })) as { doc?: { body?: unknown }; updatedAt?: string } | null;
      if (!row || typeof row.doc?.body !== "string")
        throw new KodyActionError("policy_not_found", "Policy was not found.");
      const parsed = splitContextFrontmatter(row.doc.body);
      return {
        id: slug,
        body: parsed.body.trim(),
        agents: parsed.frontmatter.agent,
        updatedAt: row.updatedAt,
      };
    },
    async getInstructions(principal) {
      const row = (await createBackendClient().query(backendApi.repoDocs.get, {
        tenantId: principal.tenantId,
        kind: "instructions",
      })) as { doc?: { body?: unknown }; updatedAt?: string } | null;
      return row && typeof row.doc?.body === "string"
        ? { body: row.doc.body, updatedAt: row.updatedAt }
        : { body: "", updatedAt: null };
    },
    async listCapabilities(principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) => {
          const { config } = await getEngineConfig(octokit, owner, repo);
          const activeStoreSlugs = await resolveInstalledCapabilitySlugs(
            octokit,
            config,
          );
          return await listCapabilityFiles({ activeStoreSlugs });
        },
      );
    },
    async getCapability(slug, principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) => {
          const { config } = await getEngineConfig(octokit, owner, repo);
          const activeStoreSlugs = await resolveInstalledCapabilitySlugs(
            octokit,
            config,
          );
          const capability = await readResolvedCapabilityFile(slug, octokit, {
            activeStoreSlugs,
            tenantId: principal.tenantId,
          });
          if (!capability)
            throw new KodyActionError(
              "capability_not_found",
              "Capability was not found.",
            );
          return capability;
        },
      );
    },
    async listWorkflows(principal) {
      return await listWorkflowRecords(principal);
    },
    async getWorkflow(id, principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) => {
          const loaded = await createCompanyWorkflowLoader({
            octokit,
            owner,
            repo,
          })(id);
          if (!loaded)
            throw new KodyActionError(
              "workflow_not_found",
              "Workflow was not found.",
            );
          return { id, workflow: loaded.workflow };
        },
      );
    },
    async getQualityGates(principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) => {
          const { config } = await getEngineConfig(octokit, owner, repo);
          return {
            repository: principal.tenantId,
            quality: config.quality ?? {},
          };
        },
      );
    },
    async listApprovals(input, principal) {
      if (input.workRecordId) {
        return await createBackendClient().query(
          backendApi.mcpApprovalRequests.listForWork,
          {
            tenantId: principal.tenantId,
            workRecordId: String(input.workRecordId),
            limit: Number(input.limit),
          },
        );
      }
      return await createBackendClient().query(
        backendApi.mcpApprovalRequests.list,
        {
          tenantId: principal.tenantId,
          ...(input.status ? { status: input.status as never } : {}),
          limit: Number(input.limit),
        },
      );
    },
    async getApproval(requestId, principal) {
      const request = await createBackendClient().query(
        backendApi.mcpApprovalRequests.getPublic,
        { tenantId: principal.tenantId, requestId },
      );
      if (!request)
        throw new KodyActionError(
          "approval_not_found",
          "Approval request was not found.",
        );
      return request;
    },
    async requestWorkflowRun(input, principal) {
      const workflowId = String(input.workflowId);
      const workflowInput = input.input as Record<string, unknown>;
      await withRepository(principal, async ({ owner, repo, octokit }) => {
        const loaded = await createCompanyWorkflowLoader({
          octokit,
          owner,
          repo,
        })(workflowId);
        if (!loaded)
          throw new KodyActionError(
            "workflow_not_found",
            "Workflow was not found.",
          );
        const issues = [
          ...validateWorkflowDefinition(loaded.workflow),
          ...validateWorkflowInput(workflowInput, loaded.workflow.inputSchema),
        ];
        if (issues.length)
          throw new KodyActionError(
            "invalid_workflow_input",
            "Workflow input is invalid.",
          );
      });
      const { owner, repo } = repository(principal);
      const runId = `run-${randomUUID()}`;
      const challenge = createWorkflowApprovalChallenge({
        owner,
        repo,
        actor: `github:${principal.actorGithubId}`,
        workflowId,
        input: workflowInput,
        signingKey: getWorkflowApprovalSigningKey(),
      });
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "workflow",
        targetId: workflowId,
        runId,
        mode: "start",
        approvalId: challenge.approvalId,
        approvalToken: challenge.token,
        action: challenge.action,
        approvalInput: workflowInput,
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestWorkflowResume(input, principal) {
      const workflowId = String(input.workflowId);
      const runId = String(input.runId);
      const run = (await createBackendClient().query(
        backendApi.workflowRuns.get,
        {
          tenantId: principal.tenantId,
          workflowId,
          runId,
        },
      )) as {
        state?: {
          status?: string;
          approval?: {
            stepId?: string;
            contextHash?: string;
            status?: string;
          };
        };
      } | null;
      const pending = run?.state?.approval;
      if (
        run?.state?.status !== "waiting-approval" ||
        pending?.status !== "pending" ||
        !pending.stepId ||
        !pending.contextHash
      )
        throw new KodyActionError(
          "workflow_not_waiting",
          "Workflow is not waiting for approval.",
        );
      const approvalInput = {
        runId,
        stepId: pending.stepId,
        contextHash: pending.contextHash,
      };
      const { owner, repo } = repository(principal);
      const challenge = createWorkflowApprovalChallenge({
        owner,
        repo,
        actor: `github:${principal.actorGithubId}`,
        workflowId,
        input: approvalInput,
        signingKey: getWorkflowApprovalSigningKey(),
      });
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "workflow",
        targetId: workflowId,
        runId,
        mode: "resume",
        approvalId: challenge.approvalId,
        approvalToken: challenge.token,
        action: challenge.action,
        approvalInput,
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestCapabilityRun(input, principal) {
      const capabilityId = String(input.capabilityId);
      await this.getCapability(capabilityId, principal);
      const approvalInput = input.input as Record<string, unknown>;
      const runId = `run-${randomUUID()}`;
      const approvalId = `approval-${randomUUID()}`;
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "capability",
        targetId: capabilityId,
        runId,
        mode: "start",
        approvalId,
        approvalToken: randomBytes(32).toString("base64url"),
        action: `run:${hashRequest(approvalInput)}`,
        approvalInput,
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async listSchedules(principal) {
      return await withRepository(principal, async ({ owner, repo, octokit }) =>
        (await listRepositoryLoops(octokit, owner, repo)).filter(
          (loop) => loop.trigger.type === "schedule",
        ),
      );
    },
    async getSchedule(id, principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) => {
          let loop = await readRepositoryLoop(octokit, owner, repo, id);
          for (const delay of [250, 500]) {
            if (loop) break;
            await new Promise((resolve) => setTimeout(resolve, delay));
            loop = await readRepositoryLoop(octokit, owner, repo, id);
          }
          if (!loop || loop.trigger.type !== "schedule")
            throw new KodyActionError(
              "schedule_not_found",
              "Schedule was not found.",
            );
          return loop;
        },
      );
    },
    async listTriggers(principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) =>
          await getTriggers(octokit, owner, repo, { cache: false }),
      );
    },
    async getTrigger(id, principal) {
      const triggers = (await withRepository(
        principal,
        async ({ owner, repo, octokit }) =>
          await getTriggers(octokit, owner, repo, { cache: false }),
      )) as ReadonlyArray<{ id: string }>;
      const trigger = triggers.find((item) => item.id === id);
      if (!trigger)
        throw new KodyActionError(
          "trigger_not_found",
          "Trigger was not found.",
        );
      return trigger;
    },
    async getWebhookStatus(principal) {
      return await withRepository(
        principal,
        async ({ owner, repo, octokit }) =>
          await probeWebhookHealth(octokit, owner, repo, origin),
      );
    },
    async listNotificationRules(principal) {
      return await withRepository(principal, async () => {
        const manifest = await readNotificationsManifestFresh();
        return manifest.manifest.rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          event: rule.event,
          channel: { type: rule.channel.type },
          template: rule.template,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt,
        }));
      });
    },
    async listRuns(input, principal) {
      return await createBackendClient().query(backendApi.agencyRuns.list, {
        tenantId: principal.tenantId,
        limit: Number(input.limit),
      });
    },
    async getRun(runId, principal) {
      const run = await createBackendClient().query(backendApi.agencyRuns.get, {
        tenantId: principal.tenantId,
        runId,
      });
      if (!run)
        throw new KodyActionError("run_not_found", "Run was not found.");
      return run;
    },
    async getUsage(principal) {
      const events = (await createBackendClient().query(
        backendApi.mcpAuditEvents.list,
        { tenantId: principal.tenantId, limit: 500 },
      )) as Array<{ outcome: string; actionId?: string; occurredAt: string }>;
      const byOutcome: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      for (const event of events) {
        byOutcome[event.outcome] = (byOutcome[event.outcome] ?? 0) + 1;
        if (event.actionId)
          byAction[event.actionId] = (byAction[event.actionId] ?? 0) + 1;
      }
      return {
        requestsInSample: events.length,
        sampleLimit: 500,
        rateLimitPerMinute: 120,
        byOutcome,
        byAction,
        reliabilityObjective: { availability: 0.995, window: "30d" },
        contractVersion: KODY_MCP_CONTRACT_VERSION,
        migrationPolicy: "additive-with-versioned-deprecation",
        minimumDeprecationDays: 90,
      };
    },
    async requestScheduleSave(input, principal) {
      const schedule = input.schedule as Record<string, unknown>;
      const { every, at, ...definition } = schedule;
      const loop = createLoopDefinition({
        ...definition,
        trigger: {
          type: "schedule",
          every,
          ...(at ? { at } : {}),
        },
      });
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: loop.id,
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "schedule.save",
        approvalInput: { schedule: loop },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestScheduleDelete(input, principal) {
      const id = String(input.id);
      await this.getSchedule(id, principal);
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: id,
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "schedule.delete",
        approvalInput: { id },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestTriggerSave(input, principal) {
      const trigger = triggerConfigSchema.parse(input.trigger);
      if (!isSystemEventName(trigger.event))
        throw new KodyActionError(
          "unknown_event",
          "Trigger event is not supported.",
        );
      await withRepository(principal, async () => {
        if (trigger.action.type === "start-workflow") {
          const record = (await createBackendClient().query(
            backendApi.workflows.get,
            {
              tenantId: principal.tenantId,
              workflowId: trigger.action.workflowId,
            },
          )) as { definition?: unknown } | null;
          const workflow = normalizeWorkflowDefinition(record?.definition);
          if (!workflow)
            throw new KodyActionError(
              "workflow_not_found",
              "Trigger workflow was not found.",
            );
          const eligibility = automationEligibilityForSubject(
            await readTrust(),
            trustSubjectKey("workflow", trigger.action.workflowId),
            workflow.runWithoutApproval === true,
          );
          if (!eligibility.eligible)
            throw new KodyActionError(
              "automation_approval_required",
              "Workflow is not eligible for unattended automation.",
            );
        }
        if (trigger.action.type === "start-pipeline") {
          const record = (await createBackendClient().query(
            backendApi.pipelines.get,
            {
              tenantId: principal.tenantId,
              pipelineId: trigger.action.pipelineId,
            },
          )) as { definition?: unknown } | null;
          const pipeline = normalizePipelineDefinition(record?.definition);
          if (!pipeline)
            throw new KodyActionError(
              "pipeline_not_found",
              "Trigger pipeline was not found.",
            );
          const eligibility = automationEligibilityForSubject(
            await readTrust(),
            trustSubjectKey("pipeline", trigger.action.pipelineId),
            pipeline.runWithoutApproval === true,
          );
          if (!eligibility.eligible)
            throw new KodyActionError(
              "automation_approval_required",
              "Pipeline is not eligible for unattended automation.",
            );
        }
      });
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: trigger.id,
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "trigger.save",
        approvalInput: { trigger },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestTriggerDelete(input, principal) {
      const id = String(input.id);
      await this.getTrigger(id, principal);
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: id,
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "trigger.delete",
        approvalInput: { id },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestWebhookReconcile(input, principal) {
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: "github-webhook",
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "webhook.reconcile",
        approvalInput: {},
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestNotificationRuleCreate(input, principal) {
      const rule = NotificationCreateRuleInputSchema.parse(input.rule);
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: slugifyRuleName(rule.name),
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "notification.rule.create",
        approvalInput: { rule },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
    async requestNotificationRuleDelete(input, principal) {
      const id = String(input.id);
      const rules = (await this.listNotificationRules(principal)) as Array<{
        id: string;
      }>;
      if (!rules.some((rule) => rule.id === id))
        throw new KodyActionError(
          "notification_rule_not_found",
          "Notification rule was not found.",
        );
      return await createApprovalRequest(principal, {
        workRecordId: String(input.workRecordId),
        targetKind: "automation",
        targetId: id,
        runId: `run-${randomUUID()}`,
        mode: "start",
        approvalId: `approval-${randomUUID()}`,
        approvalToken: randomBytes(32).toString("base64url"),
        action: "notification.rule.delete",
        approvalInput: { id },
        idempotencyKey: String(input.idempotencyKey),
      });
    },
  };
}
