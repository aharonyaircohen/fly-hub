import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Reports API ============

export interface Report {
  /** Report family slug — stable identity. */
  slug: string;
  /** Backend-relative markdown path for the currently shown report. */
  path: string;
  /** Run id when this report came from `reports/<slug>/runs/<run>.md`. */
  runId: string | null;
  /** Available historical runs, newest first. Empty for legacy flat reports. */
  runs: {
    id: string;
    path: string;
    generatedAt: string | null;
    htmlUrl: string;
    size: number;
  }[];
  title: string;
  body: string;
  /** Last update timestamp for this report (ISO8601). */
  updatedAt: string;
  /** Optional source link when the connected repository owns the content. */
  htmlUrl: string;
  /** Size in bytes. */
  size: number;
  capabilitySlug: string | null;
  reportType: string;
  reportTypeVersion: number;
  producer: {
    model: string | null;
    capability: string | null;
  };
  reviewStatus: string | null;
  reviewArea: string | null;
  findingCount: number;
  suggestedActions: import("../report-suggested-actions").ReportSuggestedAction[];
}

export const reportsApi = {
  list: async (): Promise<Report[]> => {
    const res = await fetch(`${API_BASE}/reports`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ reports: Report[] }>(res);
    return data.reports;
  },

  get: async (slug: string, runId?: string | null): Promise<Report> => {
    const suffix = runId
      ? `?${new URLSearchParams({ run: runId }).toString()}`
      : "";
    const res = await fetch(
      `${API_BASE}/reports/${encodeURIComponent(slug)}${suffix}`,
      {
        headers: buildHeaders(),
      },
    );
    const data = await handleResponse<{ report: Report }>(res);
    return data.report;
  },
};
