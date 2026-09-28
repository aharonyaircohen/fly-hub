/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-config
 * @ai-summary Loads the brand's custom user-state namespaces from the
 *   tenant's Convex `user-state/config.json` document, validates the spec,
 *   compiles field-specs to schemas, and merges with the core namespaces
 *   (core always wins on name collision). 60s TTL cache per owner/repo,
 *   mirroring the CMS config loader.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import { logger } from "@kody-ade/base/logger";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { CORE_USER_STATE_NAMESPACES } from "./namespaces/core";
import { compileNamespaceSchema, namespaceSpecSchema } from "./schema-compile";
import type { UserStateNamespace } from "./types";

export const USER_STATE_CONFIG_PATH = "user-state/config.json";

const CONFIG_CACHE_TTL_MS = 60 * 1000;

const configFileSchema = z
  .object({
    version: z.literal(1).default(1),
    namespaces: z.array(namespaceSpecSchema).max(100).default([]),
  })
  .strict();

interface CacheEntry {
  namespaces: readonly UserStateNamespace[];
  expires: number;
}

const cache = new Map<string, CacheEntry>();

/** Exported for unit tests — clears the namespace config cache. */
export function _resetUserStateConfigCache(): void {
  cache.clear();
}

function coreNames(): Set<string> {
  return new Set(CORE_USER_STATE_NAMESPACES.map((ns) => ns.name));
}

async function loadBrandNamespaces(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<readonly UserStateNamespace[]> {
  let raw: string | null = null;
  try {
    void octokit;
    const row = (await createBackendClient().query(api.repoDocs.get, {
      tenantId: `${owner}/${repo}`,
      kind: USER_STATE_CONFIG_PATH,
    })) as { doc?: unknown } | null;
    const doc = row?.doc as { content?: unknown } | unknown;
    raw =
      typeof doc === "string"
        ? doc
        : typeof (doc as { content?: unknown })?.content === "string"
          ? (doc as { content: string }).content
          : null;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status !== 404) {
      logger.warn({ err: error, owner, repo }, "user-state config read failed");
    }
    return [];
  }
  if (!raw) return [];

  let parsed: z.infer<typeof configFileSchema>;
  try {
    parsed = configFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    logger.warn({ err, owner, repo }, "user-state config invalid — ignored");
    return [];
  }

  const reserved = coreNames();
  const namespaces: UserStateNamespace[] = [];
  for (const spec of parsed.namespaces) {
    if (reserved.has(spec.name)) {
      logger.warn(
        { namespace: spec.name, owner, repo },
        "user-state config: core namespace collision — brand entry ignored",
      );
      continue;
    }
    // Compile per-spec so one bad entry (e.g. a malformed field regex) drops
    // only that namespace, never the brand's whole user-state surface.
    try {
      namespaces.push({
        name: spec.name,
        version: spec.version,
        origin: "brand" as const,
        schema: compileNamespaceSchema(spec.fields),
        adapter: spec.adapter,
        merge: spec.merge,
        modelWritable: spec.modelWritable,
      });
    } catch (err) {
      logger.warn(
        { err, namespace: spec.name, owner, repo },
        "user-state config: namespace schema failed to compile — ignored",
      );
    }
  }
  return namespaces;
}

/** All namespaces for a brand: core (always) + validated brand config. */
export async function getUserStateNamespaces(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<readonly UserStateNamespace[]> {
  const key = `${owner}/${repo}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.namespaces;

  const brand = await loadBrandNamespaces(octokit, owner, repo);
  const namespaces = [...CORE_USER_STATE_NAMESPACES, ...brand];
  cache.set(key, { namespaces, expires: Date.now() + CONFIG_CACHE_TTL_MS });
  return namespaces;
}

export async function getUserStateNamespace(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
): Promise<UserStateNamespace | null> {
  const namespaces = await getUserStateNamespaces(octokit, owner, repo);
  return namespaces.find((ns) => ns.name === name) ?? null;
}
