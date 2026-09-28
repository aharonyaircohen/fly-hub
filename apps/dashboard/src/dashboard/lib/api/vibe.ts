import {
  API_BASE,
  buildHeaders,
  handleResponse,
  getStoredFlyPerf,
} from "./client";

// ============ Vibe API ============

/**
 * Vibe-specific endpoints. Distinct from tasksApi.execute (which posts
 * `@kody` and runs full orchestration on GitHub Actions). Vibe execution
 * spawns a Fly Machine directly into agent mode against the issue,
 * skipping classify/plan/review.
 */
export const vibeApi = {
  execute: async (
    issueNumber: number,
  ): Promise<{
    ok: true;
    issueNumber: number;
    runner: "fly";
    machineId: string;
    sessionId: string;
  }> => {
    const flyPerf = getStoredFlyPerf();
    const headers = buildHeaders(flyPerf ? { "x-kody-fly-perf": flyPerf } : {});
    const res = await fetch(`${API_BASE}/vibe/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ issueNumber }),
    });
    return handleResponse(res);
  },
};
