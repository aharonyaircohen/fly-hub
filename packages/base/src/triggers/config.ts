/**
 * @fileType utility
 * @domain triggers
 * @pattern trigger-config
 * @ai-summary Loads and saves the brand's trigger rules from
 *   `triggers/config.json` in the backend. Zod-validated with unknown
 *   event names and invalid entries dropped (warn), 60s TTL cache,
 *   CAS-safe writes. Same loader pattern as the user-state config.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { isSystemEventName } from "@kody-ade/base/events/catalog";
import { logger } from "@kody-ade/base/logger";
import {
  triggersFileSchema,
  type TriggerConfig,
  type TriggersFile,
} from "./types";

export const TRIGGERS_CONFIG_PATH = "triggers/config.json";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  triggers: readonly TriggerConfig[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Exported for unit tests — clears the trigger config cache. */
export function _resetTriggersConfigCache(): void {
  cache.clear();
}

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export async function getTriggers(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { cache?: boolean } = {},
): Promise<readonly TriggerConfig[]> {
  const key = cacheKey(owner, repo);
  const useCache = options.cache !== false;
  const cached = useCache ? cache.get(key) : undefined;
  if (cached && cached.expires > Date.now()) return cached.triggers;

  let triggers: readonly TriggerConfig[] = [];
  try {
    const record = await createBackendClient().query(api.repoDocs.get, {
      tenantId: `${owner}/${repo}`,
      kind: TRIGGERS_CONFIG_PATH,
    });
    if (record) {
      const parsed = triggersFileSchema.parse(record.doc);
      triggers = parsed.triggers.filter((trigger) => {
        if (!isSystemEventName(trigger.event)) {
          logger.warn(
            { trigger: trigger.id, event: trigger.event, owner, repo },
            "triggers config: unknown event name — trigger ignored",
          );
          return false;
        }
        return true;
      });
    }
  } catch (error: unknown) {
    if ((error as { status?: number })?.status !== 404) {
      logger.warn({ err: error, owner, repo }, "triggers config load failed");
    }
  }

  cache.set(key, { triggers, expires: Date.now() + CACHE_TTL_MS });
  return triggers;
}

interface TriggersFileRead {
  triggers: TriggerConfig[];
  sha: string | undefined;
}

async function readTriggersFile(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<TriggersFileRead> {
  try {
    const record = await createBackendClient().query(api.repoDocs.get, {
      tenantId: `${owner}/${repo}`,
      kind: TRIGGERS_CONFIG_PATH,
    });
    if (!record) return { triggers: [], sha: undefined };
    const parsed = triggersFileSchema.parse(record.doc);
    return { triggers: parsed.triggers, sha: record.updatedAt };
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      return { triggers: [], sha: undefined };
    }
    throw error;
  }
}

/**
 * Atomic read-modify-write on the triggers file. The write uses the sha of
 * the same read the mutation was applied to (single attempt) and re-runs
 * the whole cycle on conflict — a concurrent save can never silently drop
 * another writer's trigger.
 */
export async function mutateTriggers(
  octokit: Octokit,
  owner: string,
  repo: string,
  mutate: (triggers: readonly TriggerConfig[]) => readonly TriggerConfig[],
): Promise<readonly TriggerConfig[]> {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
    const { triggers, sha } = await readTriggersFile(octokit, owner, repo);
    const next = mutate(triggers);
    const file: TriggersFile = { version: 1, triggers: [...next] };
    try {
      await createBackendClient().mutation(api.repoDocs.save, {
        tenantId: `${owner}/${repo}`,
        kind: TRIGGERS_CONFIG_PATH,
        doc: file,
        updatedAt: new Date().toISOString(),
        expectedUpdatedAt: sha,
      });
      cache.delete(cacheKey(owner, repo));
      return next;
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      const conflict = status === 409 || status === 422;
      if (!conflict || attempt === MAX_ATTEMPTS) throw error;
    }
  }
  throw new Error("triggers config write retry exhausted");
}
