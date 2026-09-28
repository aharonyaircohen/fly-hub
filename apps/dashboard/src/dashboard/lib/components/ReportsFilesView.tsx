/**
 * @fileType component
 * @domain reports
 * @pattern reports-files-view
 * @ai-summary Reports rendered through the generic file-manager workspace:
 *   a read-only transport maps report families to folders and runs to
 *   markdown files, and report actions plug
 *   into the workspace header. Storage stays in the Convex reports API —
 *   this is a browsing surface, not a new store.
 */
"use client";

import { useMemo, useState } from "react";
import { CircleDot } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import {
  type FileEntry,
  type FilesTransport,
} from "@dashboard/features/file-manager";
import { DashboardFilesPage } from "@dashboard/features/file-spaces/DashboardFilesPage";
import { AuthGuard } from "../auth-guard";
import { useReports } from "../hooks/useReports";
import { reportsApi, type Report } from "../api/reports";
import { CreateTaskDialog } from "@dashboard/features/tasks/components/CreateTaskDialog";

function reportSourceMarkdown(report: Report): string {
  return `> Generated from report \`${report.slug}\` (${report.updatedAt}).`;
}

function runFileEntry(slug: string, run: Report["runs"][number]): FileEntry {
  return {
    name: `${run.id}.md`,
    path: `${slug}/${run.id}.md`,
    type: "file",
    size: run.size,
    sha: run.id,
  };
}

/** `<slug>.md` (flat) or `<slug>/<runId>.md` (run) → identifiers. */
function parseReportPath(
  path: string,
): { slug: string; runId: string | null } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 1 && parts[0].endsWith(".md")) {
    return { slug: parts[0].slice(0, -3), runId: null };
  }
  if (parts.length === 2 && parts[1].endsWith(".md")) {
    return { slug: parts[0], runId: parts[1].slice(0, -3) };
  }
  if (parts.length === 1) return { slug: parts[0], runId: null };
  return null;
}

export function ReportsFilesView({
  initialPath = "",
}: {
  initialPath?: string;
}) {
  const { data: reports = [] } = useReports();
  const [issueFromReport, setIssueFromReport] = useState<Report | null>(null);

  const transport = useMemo<FilesTransport>(() => {
    const bySlug = new Map(reports.map((report) => [report.slug, report]));
    return {
      cacheKey: `reports:${reports.length}:${reports[0]?.updatedAt ?? ""}`,
      async listDir(path: string): Promise<FileEntry[]> {
        const normalized = path.replace(/^\/+|\/+$/g, "");
        if (!normalized) {
          return reports.map((report) =>
            report.runs.length > 0
              ? {
                  name: report.title,
                  path: report.slug,
                  type: "dir" as const,
                  size: report.runs.length,
                  sha: report.slug,
                }
              : {
                  name: `${report.title}.md`,
                  path: `${report.slug}.md`,
                  type: "file" as const,
                  size: report.size,
                  sha: report.slug,
                },
          );
        }
        const family = bySlug.get(normalized);
        if (!family) throw new Error(`Unknown report "${normalized}"`);
        return family.runs.map((run) => runFileEntry(family.slug, run));
      },
      async readFile(path: string) {
        const parsed = parseReportPath(path.replace(/^\/+|\/+$/g, ""));
        if (!parsed) return null;
        // Directory paths (family with runs) are not files.
        if (!path.endsWith(".md") && bySlug.get(parsed.slug)?.runs.length) {
          return null;
        }
        const report = await reportsApi.get(parsed.slug, parsed.runId);
        const content = report.body.trimStart().startsWith("#")
          ? report.body
          : `# ${report.title}\n\n${report.body}`;
        return {
          path,
          sha: report.runId ?? report.slug,
          size: content.length,
          content,
          base64Content: "",
          isBinary: false,
          encoding: "utf-8" as const,
        };
      },
    };
  }, [reports]);

  const headerActions = useMemo(
    () =>
      function ReportHeaderActions({
        selectedPath,
      }: {
        selectedPath: string | null;
        isFile: boolean;
      }) {
        const parsed = selectedPath ? parseReportPath(selectedPath) : null;
        const report = parsed
          ? (reports.find((candidate) => candidate.slug === parsed.slug) ??
            null)
          : null;
        if (!report) return null;
        return (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Create issue from this report"
              aria-label="Create issue from this report"
              onClick={() => setIssueFromReport(report)}
            >
              <CircleDot className="h-4 w-4" />
            </Button>
          </>
        );
      },
    [reports],
  );

  return (
    <AuthGuard>
      <DashboardFilesPage
        title="Reports"
        routeBase="/reports"
        initialPath={initialPath}
        transport={transport}
        headerActions={(ctx) => headerActions(ctx)}
        showSearch={false}
        showUpload={false}
        defaultFileMode="view"
      />

      <CreateTaskDialog
        open={!!issueFromReport}
        onClose={() => setIssueFromReport(null)}
        prefill={
          issueFromReport
            ? {
                title: `Address: ${issueFromReport.title}`,
                body:
                  `${reportSourceMarkdown(issueFromReport)}\n\n` +
                  `---\n\n${issueFromReport.body}`,
                labels: [`from-report:${issueFromReport.slug}`],
              }
            : undefined
        }
        onCreated={() => setIssueFromReport(null)}
      />

    </AuthGuard>
  );
}
