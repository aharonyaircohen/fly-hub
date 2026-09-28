const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;

export interface LoopWakeTarget {
  tenantId: string;
  wakeId: string;
  loopId: string;
  scheduledFor: string;
}

export interface LoopWakeRequest {
  jobId: string;
  repo: string;
  runRequest: {
    requestId: string;
    target: { type: "loop"; id: string };
    intent: "tick";
    source: "schedule";
    input: { scheduledFor: string };
  };
}

export function buildLoopWakeRequest(target: LoopWakeTarget): LoopWakeRequest {
  if (!REPOSITORY.test(target.tenantId)) {
    throw new Error("Loop wake tenant must be owner/repository");
  }
  if (!target.wakeId.trim()) throw new Error("Loop wake id is required");
  return {
    jobId: target.wakeId,
    repo: target.tenantId,
    runRequest: {
      requestId: target.wakeId,
      target: { type: "loop", id: target.loopId },
      intent: "tick",
      source: "schedule",
      input: { scheduledFor: target.scheduledFor },
    },
  };
}

export async function dispatchLoopWakeToDashboard(
  target: LoopWakeTarget,
  options: {
    dashboardUrl: string;
    wakeApiKey: string;
    fetcher?: typeof fetch;
  },
): Promise<{ ok: boolean; detail: string }> {
  const url = new URL(options.dashboardUrl);
  if (url.protocol !== "https:") {
    throw new Error("Loop wake Dashboard URL must use HTTPS");
  }
  const apiKey = options.wakeApiKey.trim();
  if (!apiKey) throw new Error("Loop wake API key is required");
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(
    `${url.toString().replace(/\/+$/, "")}/api/kody/loop-wakes/dispatch`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildLoopWakeRequest(target)),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as {
      ok?: unknown;
      runner?: unknown;
    } | null;
    if (body?.ok === true && body.runner === "github-actions") {
      return { ok: true, detail: "workflow accepted" };
    }
    return { ok: false, detail: "Dashboard did not accept the workflow" };
  }
  return {
    ok: false,
    detail: `Dashboard rejected wake (HTTP ${response.status})`,
  };
}
