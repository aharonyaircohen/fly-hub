/** Shared Convex store for Markdown intents, constraints, and policies. */
import { getOwner, getRepo } from "../github";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@kody-ade/base/backend/convex";
import {
  ALL_AGENT,
  joinContextFrontmatter,
  splitContextFrontmatter,
} from "../context/frontmatter";

export type GuidanceKind = "intent" | "constraint" | "policy";

export interface GuidanceFile {
  slug: string;
  body: string;
  agent: string[];
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

interface GuidanceRecord {
  kind: string;
  doc: { body?: unknown; intent?: unknown };
  updatedAt: string;
}

interface WriteGuidanceOptions {
  slug: string;
  body: string;
  agent: string[];
}

const cache = new Map<string, { prompt: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;
const LEGACY_INTENT_KIND = "agency:intent";

export function isValidGuidanceSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function prefix(kind: GuidanceKind): string {
  return `${kind}:`;
}

function recordToFile(
  guidanceKind: GuidanceKind,
  record: GuidanceRecord,
): GuidanceFile | null {
  const slug = record.kind.slice(prefix(guidanceKind).length);
  if (!isValidGuidanceSlug(slug) || typeof record.doc?.body !== "string") {
    return null;
  }
  const { frontmatter, body } = splitContextFrontmatter(
    record.doc.body.replace(/^\s+/, ""),
  );
  return {
    slug,
    body: body.replace(/^\s+/, ""),
    agent: frontmatter.agent,
    sha: "",
    updatedAt: record.updatedAt,
    htmlUrl: "",
  };
}

function legacyIntentFile(record: GuidanceRecord): GuidanceFile | null {
  if (typeof record.doc.intent !== "string" || !record.doc.intent.trim()) {
    return null;
  }
  return {
    slug: "agency",
    body: record.doc.intent,
    agent: [ALL_AGENT],
    sha: "",
    updatedAt: record.updatedAt,
    htmlUrl: "",
  };
}

export async function listGuidanceFiles(
  guidanceKind: GuidanceKind,
): Promise<GuidanceFile[]> {
  const records = (await getConvexClient().query(
    backendApi.repoDocs.listByPrefix,
    {
      tenantId: tenantIdFor(getOwner(), getRepo()),
      prefix: prefix(guidanceKind),
    },
  )) as GuidanceRecord[];
  const files = records
    .map((record) => recordToFile(guidanceKind, record))
    .filter((file): file is GuidanceFile => file !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (
    guidanceKind === "intent" &&
    !files.some((file) => file.slug === "agency")
  ) {
    const legacy = (await getConvexClient().query(backendApi.repoDocs.get, {
      tenantId: tenantIdFor(getOwner(), getRepo()),
      kind: LEGACY_INTENT_KIND,
    })) as GuidanceRecord | null;
    const file = legacy ? legacyIntentFile(legacy) : null;
    if (file) files.push(file);
  }
  return files;
}

export async function readGuidanceFile(
  guidanceKind: GuidanceKind,
  slug: string,
): Promise<GuidanceFile | null> {
  return readGuidanceFileForTenant(
    guidanceKind,
    slug,
    tenantIdFor(getOwner(), getRepo()),
  );
}

export async function readGuidanceFileForTenant(
  guidanceKind: GuidanceKind,
  slug: string,
  explicitTenantId: string,
): Promise<GuidanceFile | null> {
  if (!isValidGuidanceSlug(slug)) return null;
  const record = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: explicitTenantId,
    kind: `${prefix(guidanceKind)}${slug}`,
  })) as GuidanceRecord | null;
  if (record) return recordToFile(guidanceKind, record);
  if (guidanceKind !== "intent" || slug !== "agency") return null;
  const legacy = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId: explicitTenantId,
    kind: LEGACY_INTENT_KIND,
  })) as GuidanceRecord | null;
  return legacy ? legacyIntentFile(legacy) : null;
}

export async function writeGuidanceFile(
  guidanceKind: GuidanceKind,
  options: WriteGuidanceOptions,
): Promise<GuidanceFile> {
  if (!isValidGuidanceSlug(options.slug)) {
    throw new Error(`Invalid ${guidanceKind} slug: "${options.slug}".`);
  }
  const content = joinContextFrontmatter(
    { agent: options.agent },
    options.body,
  );
  const normalizedContent = content.endsWith("\n") ? content : `${content}\n`;
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: `${prefix(guidanceKind)}${options.slug}`,
    doc: { body: normalizedContent },
    updatedAt,
  });
  if (guidanceKind === "intent" && options.slug === "agency") {
    await getConvexClient().mutation(backendApi.repoDocs.remove, {
      tenantId: tenantIdFor(getOwner(), getRepo()),
      kind: LEGACY_INTENT_KIND,
    });
  }
  invalidateGuidancePromptCache();
  const file = recordToFile(guidanceKind, {
    kind: `${prefix(guidanceKind)}${options.slug}`,
    doc: { body: normalizedContent },
    updatedAt,
  });
  if (!file) throw new Error(`Failed to read written ${guidanceKind}.`);
  return file;
}

export async function deleteGuidanceFile(
  guidanceKind: GuidanceKind,
  slug: string,
): Promise<void> {
  if (!isValidGuidanceSlug(slug)) {
    throw new Error(`Invalid ${guidanceKind} slug: "${slug}".`);
  }
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    kind: `${prefix(guidanceKind)}${slug}`,
  });
  if (guidanceKind === "intent" && slug === "agency") {
    await getConvexClient().mutation(backendApi.repoDocs.remove, {
      tenantId: tenantIdFor(getOwner(), getRepo()),
      kind: LEGACY_INTENT_KIND,
    });
  }
  invalidateGuidancePromptCache();
}

export async function loadGuidanceForPrompt(
  guidanceKind: GuidanceKind,
  agentSlug: string,
): Promise<string | null> {
  const key = `${getOwner()}/${getRepo()}:${guidanceKind}:${agentSlug}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.prompt || null;
  const files = await listGuidanceFiles(guidanceKind);
  const prompt = files
    .filter(
      (file) =>
        file.agent.includes(agentSlug) || file.agent.includes(ALL_AGENT),
    )
    .map((file) => `### ${file.slug}\n\n${file.body.trim()}`)
    .join("\n\n")
    .trim();
  cache.set(key, { prompt, expiresAt: Date.now() + CACHE_TTL_MS });
  return prompt || null;
}

export function invalidateGuidancePromptCache(): void {
  cache.clear();
}
