"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  buildHeaders,
  getStoredAuth,
  handleResponse,
} from "@dashboard/lib/api";
import type {
  PipelineDefinitionInput,
  PipelineDefinitionRecord,
} from "@dashboard/lib/pipeline-definitions";

const keys = {
  list: ["kody-pipeline-definitions"] as const,
  runs: (id: string) => ["kody-pipeline-runs", id] as const,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return handleResponse<T>(
    await fetch(url, {
      ...init,
      headers: buildHeaders(),
      cache: "no-store",
    }),
  );
}

export function usePipelineDefinitions() {
  return useQuery({
    queryKey: keys.list,
    enabled: !!getStoredAuth(),
    staleTime: 30_000,
    queryFn: () =>
      request<{ pipelines: PipelineDefinitionRecord[] }>(
        "/api/kody/company/pipelines",
      ).then((result) => result.pipelines),
  });
}

export function useCreatePipelineDefinition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: PipelineDefinitionInput) =>
      request<{ pipeline: PipelineDefinitionRecord }>(
        "/api/kody/company/pipelines",
        { method: "POST", body: JSON.stringify(data) },
      ).then((result) => result.pipeline),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.list });
      toast.success("Pipeline created");
    },
    onError: (error: Error) =>
      toast.error("Failed to create Pipeline", { description: error.message }),
  });
}

export function useUpdatePipelineDefinition(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: PipelineDefinitionInput) =>
      request<{ pipeline: PipelineDefinitionRecord }>(
        `/api/kody/company/pipelines/${encodeURIComponent(id)}`,
        { method: "PATCH", body: JSON.stringify(data) },
      ).then((result) => result.pipeline),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.list });
      toast.success("Pipeline updated");
    },
    onError: (error: Error) =>
      toast.error("Failed to update Pipeline", { description: error.message }),
  });
}

export function useDeletePipelineDefinition() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ success: boolean }>(
        `/api/kody/company/pipelines/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.list });
      toast.success("Pipeline removed");
    },
    onError: (error: Error) =>
      toast.error("Failed to remove Pipeline", { description: error.message }),
  });
}

export type PipelineRun = {
  runId: string;
  status:
    | "queued"
    | "running"
    | "waiting-approval"
    | "done"
    | "failed"
    | "blocked"
    | "cancelled";
  currentStepIndex: number;
  steps: Array<{
    id: string;
    workflowId: string;
    status: "pending" | "running" | "done" | "failed" | "blocked" | "cancelled";
    workflowRunId?: string;
  }>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export function usePipelineRuns(id: string) {
  return useQuery({
    queryKey: keys.runs(id),
    enabled: !!getStoredAuth() && !!id,
    refetchInterval: 3_000,
    queryFn: () =>
      request<{ runs: PipelineRun[] }>(
        `/api/kody/company/pipelines/${encodeURIComponent(id)}/runs`,
      ).then((result) => result.runs),
  });
}

export function useRunPipeline() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      data: Record<string, unknown>;
      approvalId?: string;
    }) => {
      const response = await fetch(
        `/api/kody/company/pipelines/${encodeURIComponent(input.id)}/run`,
        {
          method: "POST",
          headers: buildHeaders(),
          body: JSON.stringify({
            input: input.data,
            ...(input.approvalId ? { approvalId: input.approvalId } : {}),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data?.error === "approval_required") {
        return data as { error: "approval_required"; approvalToken: string };
      }
      return handleResponse<{ ok: true; runId: string; acceptedAt: string }>(
        new Response(JSON.stringify(data), {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
    onSuccess: (_result, input) => {
      void client.invalidateQueries({ queryKey: keys.runs(input.id) });
    },
    onError: (error: Error) =>
      toast.error("Failed to run Pipeline", { description: error.message }),
  });
}

export function useApprovePipelineRun() {
  return useMutation({
    mutationFn: (input: {
      id: string;
      approvalToken: string;
      data: Record<string, unknown>;
    }) =>
      request<{ approvalId: string }>(
        `/api/kody/company/pipelines/${encodeURIComponent(input.id)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            approvalToken: input.approvalToken,
            input: input.data,
          }),
        },
      ).then((result) => result.approvalId),
  });
}
