/**
 * @fileType util
 * @domain reports
 * @pattern chat-tools
 * @ai-summary Chat tools for report families in the configured
 *   Kody backend — list, read, and publish a timestamped run.
 *   Reports are Dashboard-facing summaries produced by engine runs.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  listReportFiles,
  readReportFile,
  writeReportRun,
  isValidSlug,
} from "@dashboard/lib/reports-files";

export function createReportTools(opts: { owner: string; repo: string }) {
  const repoRef = `${opts.owner}/${opts.repo}`;
  return {
    list_reports: tool({
      description: `List reports in ${repoRef} (backend reports/). Returns slug, title, and last-updated for each report.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const reports = await listReportFiles();
          return {
            reports: reports.map((r) => ({
              slug: r.slug,
              title: r.title,
              updatedAt: r.updatedAt,
              path: r.path,
              runId: r.runId,
              runCount: r.runs.length,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_report: tool({
      description: `Read one report from ${repoRef} in full.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const report = await readReportFile(slug);
          if (!report) return { error: `report "${slug}" not found` };
          return { report };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    publish_report: tool({
      description:
        `Publish a markdown report run in ${repoRef} (backend reports/). ` +
        `Appends a timestamped run under the given report family slug ` +
        `(e.g. "weekly-review") so it shows on the Reports page.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(50_000),
      }),
      execute: async ({ slug, title, body }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const run = await writeReportRun({
            slug,
            title,
            body,
            generatedAt: new Date().toISOString(),
          });
          return { published: true, slug, ...run };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
