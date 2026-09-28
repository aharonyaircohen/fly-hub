import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Jobs API ============

import type { KodyJob } from "../kody-job";

export const jobsApi = {
  /**
   * Run an INSTANT job — assembles to an `@kody <capability> [why]` dispatch on
   * the job's target issue/PR. Scheduled jobs persist as a capability instead (see
   * `capabilitiesApi.create`), so this only accepts `flavor: "instant"`.
   */
  run: async (
    job: KodyJob,
    actorLogin?: string,
  ): Promise<{ success: boolean; commentUrl: string; dispatch: string }> => {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ ...job, actorLogin }),
    });
    return handleResponse(res);
  },
};
