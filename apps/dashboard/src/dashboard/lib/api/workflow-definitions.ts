import type {
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  WorkflowDefinitionRecord,
} from "../workflow-definitions";
import type { WorkflowRunStateRecord } from "../workflow-run-state";
import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Workflow Definitions API ============

export const workflowDefinitionsApi = {
  list: async (): Promise<WorkflowDefinitionRecord[]> => {
    const res = await fetch(`${API_BASE}/company/workflows`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{
      workflows: WorkflowDefinitionRecord[];
    }>(res);
    return data.workflows;
  },

  get: async (id: string): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        headers: buildHeaders(),
        cache: "no-store",
      },
    );
    const data = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return data.workflow;
  },

  create: async (
    data: CreateWorkflowDefinitionInput & { actorLogin?: string },
  ): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(`${API_BASE}/company/workflows`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return payload.workflow;
  },

  update: async (
    id: string,
    data: UpdateWorkflowDefinitionInput & { actorLogin?: string },
  ): Promise<WorkflowDefinitionRecord> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    const payload = await handleResponse<{
      workflow: WorkflowDefinitionRecord;
    }>(res);
    return payload.workflow;
  },

  remove: async (id: string): Promise<void> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  run: async (
    id: string,
    options?: {
      mode?: "resume";
      runId?: string;
      approvalId?: string;
      input?: Record<string, unknown>;
    },
  ): Promise<
    | {
        kind: "accepted";
        ok: boolean;
        execution: "kody-engine";
        workflow: string;
        runId: string;
        acceptedAt: string;
      }
    | {
        kind: "approval-required";
        approvalToken: string;
        approvalExpiresAt: string;
        approvalContext?: {
          runId: string;
          stepId: string;
          contextHash: string;
        };
      }
  > => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}/run`,
      {
        method: "POST",
        headers: buildHeaders(),
        ...(options ? { body: JSON.stringify(options) } : {}),
      },
    );
    if (res.status === 409) {
      const payload = (await res.json()) as Record<string, unknown>;
      if (
        payload.error === "approval_required" &&
        typeof payload.approvalToken === "string" &&
        typeof payload.approvalExpiresAt === "string"
      ) {
        const context = payload.approvalContext as
          | Record<string, unknown>
          | undefined;
        return {
          kind: "approval-required",
          approvalToken: payload.approvalToken,
          approvalExpiresAt: payload.approvalExpiresAt,
          ...(context &&
          typeof context.runId === "string" &&
          typeof context.stepId === "string" &&
          typeof context.contextHash === "string"
            ? {
                approvalContext: {
                  runId: context.runId,
                  stepId: context.stepId,
                  contextHash: context.contextHash,
                },
              }
            : {}),
        };
      }
      throw new Error(
        typeof payload.message === "string"
          ? payload.message
          : "Workflow could not start.",
      );
    }
    const accepted = await handleResponse<{
      ok: boolean;
      execution: "kody-engine";
      workflow: string;
      runId: string;
      acceptedAt: string;
    }>(res);
    return { kind: "accepted", ...accepted };
  },

  approveRun: async (
    id: string,
    approvalToken: string,
    input: Record<string, unknown>,
  ): Promise<string> => {
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ approvalToken, input }),
      },
    );
    const payload = await handleResponse<{ approvalId: string }>(res);
    return payload.approvalId;
  },

  latestRun: async (
    id: string,
    runId?: string,
  ): Promise<WorkflowRunStateRecord | null> => {
    const query = runId ? `?${new URLSearchParams({ runId }).toString()}` : "";
    const res = await fetch(
      `${API_BASE}/company/workflows/${encodeURIComponent(id)}/runs${query}`,
      { headers: buildHeaders(), cache: "no-store" },
    );
    const data = await handleResponse<{ run: WorkflowRunStateRecord | null }>(
      res,
    );
    return data.run;
  },
};
