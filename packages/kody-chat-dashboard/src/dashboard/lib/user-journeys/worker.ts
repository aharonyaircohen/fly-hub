import type { JourneyDefinition } from "./contracts";
import { runJourneyScenario, type JourneyBrowserPage } from "./runner";

export interface JourneyRunStore {
  updateRun(input: {
    tenantId: string;
    runId: string;
    status: "running" | "passed" | "failed";
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  }): Promise<unknown>;
  appendRunEvent(input: {
    tenantId: string;
    runId: string;
    event: unknown;
    time: string;
  }): Promise<unknown>;
}

export async function executeJourneyRun(input: {
  tenantId: string;
  runId: string;
  definition: JourneyDefinition;
  page: JourneyBrowserPage;
  store: JourneyRunStore;
  now?: () => string;
}): Promise<{ status: "passed" | "failed"; error?: string }> {
  const now = input.now ?? (() => new Date().toISOString());
  const startedAt = now();
  await input.store.updateRun({
    tenantId: input.tenantId,
    runId: input.runId,
    status: "running",
    updatedAt: startedAt,
    startedAt,
  });

  try {
    for (const scenario of input.definition.scenarios) {
      await input.store.appendRunEvent({
        tenantId: input.tenantId,
        runId: input.runId,
        event: { type: "scenario_started", scenarioId: scenario.id },
        time: now(),
      });
      for (const step of scenario.steps) {
        await input.store.appendRunEvent({
          tenantId: input.tenantId,
          runId: input.runId,
          event: { type: "step_started", scenarioId: scenario.id, stepId: step.id },
          time: now(),
        });
      }
      const result = await runJourneyScenario(input.page, scenario);
      for (const step of result.steps) {
        await input.store.appendRunEvent({
          tenantId: input.tenantId,
          runId: input.runId,
          event: { type: `step_${step.status}`, scenarioId: scenario.id, stepId: step.stepId, error: step.error },
          time: now(),
        });
      }
      if (result.status === "failed") {
        const error = result.steps.find((step) => step.status === "failed")?.error ?? "Journey scenario failed";
        await input.store.updateRun({ tenantId: input.tenantId, runId: input.runId, status: "failed", updatedAt: now(), finishedAt: now(), error });
        return { status: "failed", error };
      }
    }
    await input.store.updateRun({ tenantId: input.tenantId, runId: input.runId, status: "passed", updatedAt: now(), finishedAt: now() });
    return { status: "passed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Journey run failed";
    await input.store.updateRun({ tenantId: input.tenantId, runId: input.runId, status: "failed", updatedAt: now(), finishedAt: now(), error: message });
    return { status: "failed", error: message };
  }
}
