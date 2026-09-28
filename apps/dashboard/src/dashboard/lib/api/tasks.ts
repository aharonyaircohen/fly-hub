import type {
  KodyTask,
  TaskDocument,
  TasksResponse,
  ActionResponse,
} from "@kody-ade/base/types";
import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Tasks API ============

export const tasksApi = {
  listWithMeta: async (params?: {
    days?: number;
    includeDetails?: boolean;
    viewMode?:
      | "all"
      | "running"
      | "backlog"
      | "history"
      | "unassigned"
      | "intake"
      | "queue";
    page?: number;
    perPage?: number;
    status?: string;
    label?: string;
    priority?: string;
    q?: string;
    sort?: string;
    dir?: "asc" | "desc";
  }): Promise<TasksResponse> => {
    const searchParams = new URLSearchParams();
    if (params?.days) searchParams.set("days", String(params.days));
    if (params?.viewMode) searchParams.set("view", params.viewMode);
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.perPage) searchParams.set("perPage", String(params.perPage));
    if (params?.status && params.status !== "all")
      searchParams.set("status", params.status);
    if (params?.label && params.label !== "all")
      searchParams.set("label", params.label);
    if (params?.priority && params.priority !== "all")
      searchParams.set("priority", params.priority);
    if (params?.q) searchParams.set("q", params.q);
    if (params?.sort) searchParams.set("sort", params.sort);
    if (params?.dir) searchParams.set("dir", params.dir);
    if (params?.includeDetails === false)
      searchParams.set("includeDetails", "false");

    const url = `${API_BASE}/tasks${searchParams.toString() ? `?${searchParams}` : ""}`;
    const res = await fetch(url, { headers: buildHeaders() });
    return handleResponse<TasksResponse>(res);
  },

  list: async (params?: {
    days?: number;
    includeDetails?: boolean;
    viewMode?:
      | "all"
      | "running"
      | "backlog"
      | "history"
      | "unassigned"
      | "intake"
      | "queue";
  }): Promise<KodyTask[]> => {
    const data = await tasksApi.listWithMeta(params);
    return data.tasks;
  },

  get: async (
    issueNumber: number,
  ): Promise<{
    task: KodyTask;
    assignees: Array<{ login: string; avatar_url: string }>;
    comments: unknown[];
  }> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },

  create: async (data: {
    title: string;
    body: string;
    mode: string;
    labels?: string[];
    assignees?: string[];
    attachments?: Array<{ name: string; content: string }>;
    actorLogin?: string;
    /**
     * When false, the server skips the @kody auto-comment so the issue is
     * created without kicking off the Kody pipeline. Defaults to true
     * server-side.
     */
    autoTrigger?: boolean;
  }): Promise<KodyTask> => {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },

  update: async (
    issueNumber: number,
    data: {
      title?: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
      actorLogin?: string;
    },
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "update",
        title: data.title,
        body: data.body,
        labels: data.labels,
        assignees: data.assignees,
        ...(data.actorLogin && { actorLogin: data.actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  execute: async (
    issueNumber: number,
    _actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/start`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({}),
    });
    return handleResponse(res);
  },

  rerun: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "rerun",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  close: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  closeIssue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close-issue",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  closePR: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "close-pr",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  reset: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "reset",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  reopen: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "reopen",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  abort: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "abort",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approveUI: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve-ui",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approvePR: async (
    issueNumber: number,
    actorLogin?: string,
    options?: { approveDrafts?: boolean },
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "approve-pr",
        ...(actorLogin && { actorLogin }),
        ...(options?.approveDrafts !== undefined && {
          approveDrafts: options.approveDrafts,
        }),
      }),
    });
    return handleResponse(res);
  },

  reportIssue: async (
    issueNumber: number,
    notes: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "report-issue",
        comment: notes,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  comment: async (
    issueNumber: number,
    comment: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "comment",
        comment,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  // Retry with context: empty context posts `@kody resume` (preserves state,
  // continues from the last completed step). Non-empty context posts a bare
  // `@kody` followed by the context — that routes to classify on issues
  // (full restart from scratch) or fix on PRs (context = fix feedback).
  retryWithContext: async (
    issueNumber: number,
    context: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const comment = context.trim()
      ? `@kody\n\n${context.trim()}`
      : "@kody resume";

    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "comment",
        comment,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  fixRequest: async (
    issueNumber: number,
    fixDescription: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "fix",
        comment: fixDescription,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  approveReview: async (
    task: KodyTask,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    if (!task.associatedPR) {
      throw new Error("No PR associated with this task");
    }
    const res = await fetch(`${API_BASE}/tasks/approve-review`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        prNumber: task.associatedPR.number,
        issueNumber: task.issueNumber,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  assign: async (
    issueNumber: number,
    assignees: string[],
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "assign",
        assignees,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  unassign: async (
    issueNumber: number,
    assignees: string[],
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "unassign",
        assignees,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  addToQueue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "add-label",
        label: "kody:queued",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  removeFromQueue: async (
    issueNumber: number,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "remove-label",
        label: "kody:queued",
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  addLabel: async (
    issueNumber: number,
    label: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "add-label",
        label,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },

  removeLabel: async (
    issueNumber: number,
    label: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/tasks/issue-${issueNumber}/actions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        action: "remove-label",
        label,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },
};
// ============ Task Documents API ============

export const taskDocsApi = {
  list: async (taskId: string, branch?: string): Promise<TaskDocument[]> => {
    const params = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    const res = await fetch(`${API_BASE}/tasks/${taskId}/docs${params}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ documents: TaskDocument[] }>(res);
    return data.documents;
  },
};
