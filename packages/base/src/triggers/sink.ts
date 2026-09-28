/**
 * @fileType utility
 * @domain triggers
 * @pattern trigger-sink
 * @ai-summary The trigger engine as a system-event sink: for each event with
 *   a brand and a user, load the brand's trigger rules, and for every match
 *   save the mapped data through the injected state writer (installed by the
 *   host — see state-writer.ts). System-sourced events are skipped so a
 *   trigger's own write can never re-trigger into a loop. Best-effort: a
 *   failing trigger warns and never breaks others.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import { createUserOctokit } from "@kody-ade/base/github/core";
import { logger } from "@kody-ade/base/logger";
import type {
  SystemEventEnvelope,
  SystemEventSink,
} from "@kody-ade/base/events/types";
import { getTriggers } from "./config";
import { resolveActionData, triggerMatches } from "./engine";
import { getTriggerStateWriter } from "./state-writer";

async function resolveOctokit(
  ctxOctokit: unknown | null,
  owner: string,
  repo: string,
): Promise<Octokit | null> {
  if (ctxOctokit) return ctxOctokit as Octokit;
  const bg = await resolveBackgroundToken(owner, repo);
  return bg ? createUserOctokit(bg.token) : null;
}

async function runTriggersForEvent(
  event: SystemEventEnvelope,
  ctxOctokit: unknown | null,
): Promise<void> {
  if (!event.brand || !event.userId) return;
  // System-sourced events (e.g. a trigger's own state write) never fire
  // triggers — this is the loop guard.
  if (event.source === "system") return;

  const writer = getTriggerStateWriter();
  if (!writer) return;

  const octokit = await resolveOctokit(
    ctxOctokit,
    event.brand.owner,
    event.brand.repo,
  );
  if (!octokit) return;

  const triggers = await getTriggers(
    octokit,
    event.brand.owner,
    event.brand.repo,
  );
  const matching = triggers.filter((trigger) => triggerMatches(trigger, event));

  for (const trigger of matching) {
    try {
      if (trigger.action.type !== "save-user-state") continue;
      const data = resolveActionData(trigger, event);
      if (Object.keys(data).length === 0) continue;
      await writer({
        octokit,
        owner: event.brand.owner,
        repo: event.brand.repo,
        userId: event.userId,
        sessionId: event.sessionId,
        namespace: trigger.action.namespace,
        data,
      });
    } catch (err) {
      logger.warn(
        { err, trigger: trigger.id, event: event.name },
        "trigger execution failed",
      );
    }
  }
}

export const triggerSink: SystemEventSink = {
  name: "triggers",
  async handle(events, ctx) {
    for (const event of events) {
      await runTriggersForEvent(event, ctx.octokit);
    }
  },
};
