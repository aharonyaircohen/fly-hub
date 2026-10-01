import { cancellationMatches } from "./app-cancellation-record.ts";

export const appCancellation = new AbortController();
export function checkAppCancellation() {
  appCancellation.signal.throwIfAborted();
}
export async function monitorAppCancellation() {
  const app = process.env.FLY_APP_NAME,
    workerId = process.env.FLY_MACHINE_ID,
    token = process.env.FLY_API_TOKEN;
  if (!app || !workerId || !token) return () => undefined;
  let polling = false;
  const poll = async () => {
    if (polling || appCancellation.signal.aborted) return;
    polling = true;
    try {
      const response = await fetch(
        `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines`,
        {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return;
      const machines = (await response.json()) as Array<{
        config?: { metadata?: Record<string, string> };
      }>;
      if (
        machines.some((machine) =>
          cancellationMatches(machine.config?.metadata ?? {}, {
            orgSlug: process.env.FLY_ORG_SLUG || "personal",
            workerId,
            taskId: process.env.APP_TASK_ID,
          }),
        )
      )
        appCancellation.abort(new Error("APP_SETUP_CANCELLED"));
    } catch {
      /* A temporary API failure must not terminate a healthy deployment. */
    } finally {
      polling = false;
    }
  };
  await poll();
  const timer = setInterval(() => void poll(), 4_000);
  timer.unref();
  return () => clearInterval(timer);
}
