import type {
  Board,
  GitHubCollaborator,
  BoardsResponse,
  CollaboratorsResponse,
  WorkflowRun,
} from "@kody-ade/base/types";
import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Boards API ============

export const boardsApi = {
  list: async (): Promise<Board[]> => {
    const res = await fetch(`${API_BASE}/boards`, { headers: buildHeaders() });
    const data = await handleResponse<BoardsResponse>(res);
    return data.boards;
  },
};

// ============ Collaborators API ============

export const collaboratorsApi = {
  list: async (): Promise<GitHubCollaborator[]> => {
    const res = await fetch(`${API_BASE}/collaborators`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<CollaboratorsResponse>(res);
    return data.collaborators;
  },
};

// ============ Workflows API ============

export const workflowsApi = {
  list: async (params?: { status?: string }): Promise<WorkflowRun[]> => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set("status", params.status);
    const url = `${API_BASE}/workflows${searchParams.toString() ? `?${searchParams}` : ""}`;
    const res = await fetch(url, { headers: buildHeaders() });
    const data = await handleResponse<{ runs: WorkflowRun[] }>(res);
    return data.runs;
  },
};

// ============ Default-branch CI API ============

export interface DefaultBranchCI {
  state: "success" | "failure" | "pending" | "unknown";
  branch: string;
  sha?: string;
  latestRun?: {
    id: number;
    name: string;
    status: "queued" | "in_progress" | "completed";
    conclusion: string | null;
    html_url: string;
    updated_at: string;
  };
  failingRuns: Array<{
    id: number;
    name: string;
    conclusion: string;
    html_url: string;
    updated_at: string;
  }>;
  fetchedAt: string;
}

export const ciApi = {
  main: async (): Promise<DefaultBranchCI> => {
    const res = await fetch(`${API_BASE}/ci/main`, { headers: buildHeaders() });
    return handleResponse<DefaultBranchCI>(res);
  },
  rerun: async (runId: number): Promise<{ ok: true; runId: number }> => {
    const res = await fetch(`${API_BASE}/ci/rerun`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ runId }),
    });
    return handleResponse(res);
  },
};
