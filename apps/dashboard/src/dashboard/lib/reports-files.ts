/**
 * @fileType utility
 * @domain kody
 * @pattern reports-files
 * @ai-summary Read-only access to report families in the Convex backend
 *   (reports.list, tenant-scoped by owner/repo). Docs hold the raw markdown
 *   body; flat docs (no runId) are legacy single reports, docs with runId
 *   form append-only report families.
 */

import { getOwner, getRepo } from "./github-client";
import {
  parseReportSuggestedActions,
  type ReportSuggestedAction,
} from "./report-suggested-actions";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "./backend/convex-backend";
import { normalizeReportType } from "./report-types";

export interface ReportProducer {
  model: string | null;
  capability: string | null;
}

export interface ReportFile {
  /** Report family slug — stable identity. */
  slug: string;
  /** Backend-relative markdown path for the currently shown report. */
  path: string;
  /** Run id when this report came from `reports/<slug>/runs/<run>.md`. */
  runId: string | null;
  /** Available historical runs, newest first. Empty for legacy flat reports. */
  runs: ReportRun[];
  /** First H1 of the body, or humanized slug fallback. */
  title: string;
  /** Markdown body (post-H1 if present, else the entire file). */
  body: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Size in bytes (helps preview length without fetching body). */
  size: number;
  /** Producer capability metadata from report frontmatter. */
  capabilitySlug: string | null;
  /** Extensible report type used by Reports filters and optional renderers. */
  reportType: string;
  reportTypeVersion: number;
  producer: ReportProducer;
  /** Review routing status, from report frontmatter. */
  reviewStatus: string | null;
  /** Review routing area, from report frontmatter. */
  reviewArea: string | null;
  /** Count of structured findings declared in report frontmatter. */
  findingCount: number;
  /** Action buttons suggested by report frontmatter. */
  suggestedActions: ReportSuggestedAction[];
}

export interface ReportRun {
  id: string;
  path: string;
  generatedAt: string | null;
  htmlUrl: string;
  size: number;
}

const REPORTS_DIR = "reports";
const RUNS_DIR = "runs";
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitReportFrontmatter(raw: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: null, body: raw };
  return {
    frontmatter: match[1] ?? "",
    body: raw.slice(match[0].length),
  };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function topLevelValue(frontmatter: string | null, key: string): string | null {
  if (!frontmatter) return null;
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!match) return null;
  const value = unquote(match[1] ?? "");
  return value.length > 0 ? value : null;
}

function nestedValue(
  frontmatter: string | null,
  objectKey: string,
  key: string,
): string | null {
  if (!frontmatter) return null;
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) =>
    new RegExp(`^${objectKey}:\\s*$`).test(line),
  );
  if (start < 0) return null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = line.match(new RegExp(`^\\s{2}${key}:\\s*(.*)$`));
    if (match) return unquote(match[1] ?? "") || null;
  }
  return null;
}

function positiveInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function countFindings(frontmatter: string | null): number {
  if (!frontmatter) return 0;
  return (frontmatter.match(/^\s{2}-\s+id:\s*/gm) ?? []).length;
}

function markdownField(markdown: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    markdown
      .match(new RegExp(`^- \\*\\*${escaped}:\\*\\*\\s*(.+)$`, "mi"))?.[1]
      ?.trim() || null
  );
}

function runIdFromName(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  const id = name.slice(0, -".md".length);
  if (id.length === 0 || id.startsWith(".") || id.startsWith("_")) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) return null;
  return id;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export function isValidRunId(runId: string): boolean {
  return runIdFromName(`${runId}.md`) === runId;
}

function runIdToIso(id: string): string | null {
  const normalized = id.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, "T$1:$2:$3Z");
  return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function deriveTitle(body: string, slug: string): string {
  const firstLine = body.trimStart().split("\n", 1)[0] ?? "";
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (h1) return h1[1]!.trim();
  return slug
    .split(/[-_]+/)
    .filter((s) => s.length > 0)
    .map((s) => s[0]!.toUpperCase() + s.slice(1))
    .join(" ");
}

function stripLeadingH1(body: string): string {
  const trimmed = body.replace(/^﻿/, "");
  const lines = trimmed.split("\n");
  if (lines.length > 0 && /^#\s+.+/.test(lines[0]!)) {
    return lines.slice(1).join("\n").replace(/^\n+/, "");
  }
  return trimmed;
}

function parseReportMarkdown(raw: string, slug: string) {
  const { frontmatter, body: afterFrontmatter } = splitReportFrontmatter(raw);
  const visibleValue = (label: string) =>
    markdownField(afterFrontmatter, label);
  return {
    generatedAt:
      visibleValue("Generated") ?? topLevelValue(frontmatter, "generatedAt"),
    title: deriveTitle(afterFrontmatter, slug),
    body: stripLeadingH1(afterFrontmatter),
    capabilitySlug:
      visibleValue("Capability") ??
      topLevelValue(frontmatter, "capabilitySlug") ??
      topLevelValue(frontmatter, "capabilitySlug"),
    reportType: normalizeReportType(
      visibleValue("Type") ?? topLevelValue(frontmatter, "reportType"),
    ),
    reportTypeVersion: positiveInteger(
      visibleValue("Version") ??
        topLevelValue(frontmatter, "reportTypeVersion"),
    ),
    producer: {
      model:
        visibleValue("Owner") ?? nestedValue(frontmatter, "producer", "model"),
      capability:
        visibleValue("Capability") ??
        nestedValue(frontmatter, "producer", "capability"),
    },
    reviewStatus:
      visibleValue("Review status") ??
      topLevelValue(frontmatter, "reviewStatus"),
    reviewArea:
      visibleValue("Review area") ?? topLevelValue(frontmatter, "reviewArea"),
    findingCount:
      (afterFrontmatter.match(/^## Finding\s*$/gm) ?? []).length ||
      countFindings(frontmatter),
    suggestedActions: parseReportSuggestedActions(frontmatter),
  };
}

function sortRunsNewestFirst(a: ReportRun, b: ReportRun): number {
  const at = a.generatedAt ?? a.id;
  const bt = b.generatedAt ?? b.id;
  return bt.localeCompare(at);
}

interface ReportDoc {
  slug: string;
  runId?: string;
  body: string;
  updatedAt: string;
}

function reportFileFromDoc(doc: ReportDoc, runs: ReportRun[]): ReportFile {
  const runId = doc.runId ?? null;
  const parsed = parseReportMarkdown(doc.body, doc.slug);
  const generatedAt =
    parsed.generatedAt ??
    (runId
      ? (runs.find((run) => run.id === runId)?.generatedAt ?? null)
      : null);
  const path = runId
    ? `${REPORTS_DIR}/${doc.slug}/${RUNS_DIR}/${runId}.md`
    : `${REPORTS_DIR}/${doc.slug}.md`;
  return {
    slug: doc.slug,
    path,
    runId,
    runs,
    title: parsed.title,
    body: parsed.body,
    updatedAt: generatedAt ?? doc.updatedAt,
    htmlUrl: "",
    size: doc.body.length,
    capabilitySlug: parsed.capabilitySlug,
    reportType: parsed.reportType,
    reportTypeVersion: parsed.reportTypeVersion,
    producer: parsed.producer,
    reviewStatus: parsed.reviewStatus,
    reviewArea: parsed.reviewArea,
    findingCount: parsed.findingCount,
    suggestedActions: parsed.suggestedActions,
  };
}

function runsForSlug(docs: ReportDoc[], slug: string): ReportRun[] {
  return docs
    .filter(
      (doc): doc is ReportDoc & { runId: string } =>
        doc.slug === slug && typeof doc.runId === "string",
    )
    .map((doc) => ({
      id: doc.runId,
      path: `${REPORTS_DIR}/${slug}/${RUNS_DIR}/${doc.runId}.md`,
      generatedAt: runIdToIso(doc.runId),
      htmlUrl: "",
      size: doc.body.length,
    }))
    .sort(sortRunsNewestFirst);
}

async function listReportDocs(): Promise<ReportDoc[]> {
  return (await getConvexClient().query(backendApi.reports.list, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
  })) as ReportDoc[];
}

/**
 * List every report family in the Convex backend. One entry per slug —
 * run-based families surface their newest run.
 */
export async function listReportFiles(): Promise<ReportFile[]> {
  const docs = await listReportDocs();
  const bySlug = new Map<string, ReportFile>();

  for (const doc of docs) {
    if (doc.runId !== undefined) continue;
    if (!isValidSlug(doc.slug)) continue;
    bySlug.set(doc.slug, reportFileFromDoc(doc, []));
  }

  const runSlugs = [
    ...new Set(
      docs
        .filter((doc) => doc.runId !== undefined && isValidSlug(doc.slug))
        .map((doc) => doc.slug),
    ),
  ];
  for (const slug of runSlugs) {
    const runs = runsForSlug(docs, slug);
    const latest = runs[0];
    if (!latest) continue;
    const doc = docs.find((d) => d.slug === slug && d.runId === latest.id);
    if (!doc) continue;
    bySlug.set(slug, reportFileFromDoc(doc, runs));
  }

  // Most recently produced first — reports are time-sensitive health signals.
  return [...bySlug.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

/**
 * Publish a new run under a report family. Returns the created run id.
 */
export async function writeReportRun(input: {
  slug: string;
  title: string;
  body: string;
  generatedAt: string;
  runId?: string;
}): Promise<{ runId: string; path: string }> {
  if (!isValidSlug(input.slug)) {
    throw new Error(`invalid report slug "${input.slug}"`);
  }
  const runId =
    input.runId ??
    input.generatedAt.replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  if (!isValidRunId(runId)) {
    throw new Error(`invalid report run id "${runId}"`);
  }
  const raw = `---\ngeneratedAt: ${input.generatedAt}\n---\n# ${input.title}\n\n${input.body.replace(/\n*$/, "\n")}`;
  await getConvexClient().mutation(backendApi.reports.save, {
    tenantId: tenantIdFor(getOwner(), getRepo()),
    slug: input.slug,
    runId,
    title: input.title,
    body: raw,
    meta: {},
    updatedAt: input.generatedAt,
  });
  return {
    runId,
    path: `${REPORTS_DIR}/${input.slug}/${RUNS_DIR}/${runId}.md`,
  };
}

/**
 * Read a single report by slug (optionally a specific run). Returns `null`
 * when it does not exist.
 */
export async function readReportFile(
  slug: string,
  runId?: string | null,
): Promise<ReportFile | null> {
  if (!isValidSlug(slug)) return null;
  if (runId && !isValidRunId(runId)) return null;

  const docs = await listReportDocs();
  const runs = runsForSlug(docs, slug);
  const targetRunId = runId ?? runs[0]?.id ?? null;
  if (targetRunId) {
    const doc = docs.find((d) => d.slug === slug && d.runId === targetRunId);
    return doc ? reportFileFromDoc(doc, runs) : null;
  }
  const flat = docs.find((d) => d.slug === slug && d.runId === undefined);
  return flat ? reportFileFromDoc(flat, []) : null;
}
