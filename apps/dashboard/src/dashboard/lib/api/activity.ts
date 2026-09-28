import { API_BASE, buildHeaders, handleResponse } from "./client";

export type WorkflowEventDeliveryStatus = "pending" | "dispatched" | "failed";

export interface WorkflowEventDelivery {
  deliveryId: string;
  triggerId: string;
  workflowId: string;
  eventName: string;
  requestId: string;
  sourceEventId?: string;
  sourceUrl?: string;
  status: WorkflowEventDeliveryStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

// ============ Activity API ============

/** Engine run health for the connected repo (read-only). */
export const activityApi = {
  agentRuns: async (
    limit = 50,
  ): Promise<import("../activity/agent-runs").AgentRunsPayload> => {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await fetch(`${API_BASE}/activity/agents?${params}`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    return handleResponse(res);
  },
  workflowEvents: async (
    limit = 20,
  ): Promise<{
    events: WorkflowEventDelivery[];
    total: number;
    computedAt: string;
  }> => {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await fetch(`${API_BASE}/workflow-events?${params}`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  get: async (): Promise<import("../activity/types").ActivitySnapshot> => {
    const res = await fetch(`${API_BASE}/activity`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Engine + chat event feed. Load-on-demand only — never polled. */
  feed: async (): Promise<import("../activity/feed").FeedSnapshot> => {
    const res = await fetch(`${API_BASE}/activity/feed`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Kody run timelines loaded from GitHub Actions artifacts. */
  runLogs: async (): Promise<
    import("@kody-ade/base/activity/run-logs").KodyRunLogsSnapshot
  > => {
    const res = await fetch(`${API_BASE}/activity/run-logs`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Dashboard-native action log (in-memory; free to poll). */
  log: async (): Promise<{
    entries: import("../activity/action-log").ActionLogEntry[];
    total: number;
    computedAt: string;
  }> => {
    const res = await fetch(`${API_BASE}/activity/log`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /** Company activity — engine-authored, attributed actions (capability runs). */
  autonomous: async (): Promise<{
    records: import("@kody-ade/base/activity/company").CompanyActivityRecord[];
    total: number;
    computedAt?: string;
  }> => {
    const res = await fetch(`${API_BASE}/activity/autonomous`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  /**
   * Upstream health — "can runs even start, and are their dependencies
   * healthy?" (GitHub Actions status, token rate-limit, webhook, vault,
   * model key, recent runs, dispatch failures). Cheap to poll.
   */
  health: async (): Promise<import("../health/types").HealthReport> => {
    const res = await fetch(`${API_BASE}/health`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
};

// ============ Agency Runs API ============

/** Kody-native run monitor for loops and workflows. */
export const agencyRunsApi = {
  list: async (
    limit = 50,
  ): Promise<import("../agency-runs").AgencyRunsPayload> => {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await fetch(`${API_BASE}/agency-runs?${params}`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
  detail: async (
    runId: string,
    githubRunId?: string | null,
  ): Promise<import("../agency-runs").AgencyRunDetailPayload> => {
    const params = new URLSearchParams({ runId });
    if (githubRunId) params.set("githubRunId", githubRunId);
    const res = await fetch(`${API_BASE}/agency-runs/detail?${params}`, {
      headers: buildHeaders(),
    });
    return handleResponse(res);
  },
};
