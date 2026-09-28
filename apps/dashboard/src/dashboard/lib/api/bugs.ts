import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Kody bug reports (filed into the dashboard's own repo) ============

export interface KodyBugReportInput {
  title: string;
  area: string;
  severity: string;
  whatHappened: string;
  steps?: string;
  expected?: string;
  where?: string;
  reporterLogin?: string;
  diagnostics?: Record<string, string | undefined>;
  capturedState?: {
    sections?: Array<{
      title: string;
      items: Array<{ label: string; value: string }>;
    }>;
    recentMessages?: Array<{ role: "user" | "assistant"; text: string }>;
    recentToolCalls?: Array<{
      name: string;
      status: string;
      summary?: string;
    }>;
  };
}

export interface KodyBugReportResult {
  success: boolean;
  issue: { number: number; title: string; html_url: string };
}

export const kodyBugsApi = {
  report: async (data: KodyBugReportInput): Promise<KodyBugReportResult> => {
    const res = await fetch(`${API_BASE}/report-kody-bug`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse(res);
  },
};
