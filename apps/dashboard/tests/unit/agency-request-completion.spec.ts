import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listTodoFiles: vi.fn(),
  writeTodoFile: vi.fn(),
  writeReportRun: vi.fn(),
  saveBlueprintInstallation: vi.fn(),
}));

vi.mock("@kody-ade/workspace/todos/files", () => ({
  listTodoFiles: h.listTodoFiles,
  writeTodoFile: h.writeTodoFile,
}));

vi.mock("@dashboard/lib/reports-files", () => ({
  writeReportRun: h.writeReportRun,
}));

vi.mock("@dashboard/lib/blueprint-installations", () => ({
  saveBlueprintInstallation: h.saveBlueprintInstallation,
}));

import { completeAgencyRequestsForWorkflow } from "@dashboard/features/agency/server/agency-request-completion";
import { agencyRequestReportSlug } from "@dashboard/features/agency/server/agency-request-report";

describe("Agency request completion", () => {
  it("keeps long Todo identities distinct within the Report slug limit", () => {
    const first = agencyRequestReportSlug(`${"long-blueprint-".repeat(5)}one`);
    const second = agencyRequestReportSlug(`${"long-blueprint-".repeat(5)}two`);

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.writeReportRun.mockResolvedValue({
      runId: "run-123",
      path: "reports/agency-request-healthy-ci/runs/run-123.md",
    });
    h.writeTodoFile.mockResolvedValue({ slug: "healthy-ci" });
    h.listTodoFiles.mockResolvedValue([
      {
        slug: "healthy-ci",
        title: "Build Healthy CI",
        description: "Kody is applying this Blueprint.",
        items: [
          {
            id: "request-1",
            title: "Validate the request and Blueprint",
            body: "Validate it.",
            assignee: null,
            completed: false,
            createdAt: "2026-08-14T10:00:00.000Z",
            completedAt: null,
            meta: { kind: "agency-request-validation" },
          },
        ],
        createdAt: "2026-08-14T10:00:00.000Z",
        updatedAt: "2026-08-14T10:00:00.000Z",
        path: "todos/healthy-ci.json",
        sha: "",
        htmlUrl: "",
        frontmatter: {},
        agencyRequest: {
          phase: "monitoring",
          source: {
            kind: "store-blueprint",
            blueprintId: "healthy-ci",
            requestId: "click-2",
          },
          requirement: {
            outcome: "Build repository-native CI",
            permissions: "Open a PR; do not merge",
            success: "Repository CI passes",
          },
          questions: [],
          plan: ["Inspect the repository", "Run apply-strategy"],
          execution: {
            workflowId: "apply-strategy",
            input: { blueprintId: "healthy-ci", blueprintVersion: "1.1.0" },
            activations: [{ kind: "solution", id: "ci-repair" }],
          },
          evidence: ["Blueprint validated"],
          blockers: [],
          related: [
            { kind: "strategy", id: "healthy-ci" },
            { kind: "run", id: "run-123" },
            { kind: "loop", id: "agency-request-healthy-ci" },
          ],
        },
      },
    ]);
  });

  it("publishes one completion report and links it from the completed Todo", async () => {
    const result = await completeAgencyRequestsForWorkflow({
      octokit: { rest: {} } as never,
      owner: "acme",
      repo: "widgets",
      workflowId: "apply-strategy",
      runId: "run-123",
      status: "success",
      summary: "Draft PR #42 is green.",
      output: {
        pullRequestUrl: "https://github.com/acme/widgets/pull/42",
        pullRequestNumber: 42,
        agencyVerification: {
          passed: true,
          evidence: "Repository CI passes on draft PR #42.",
        },
      },
    });

    expect(result).toEqual({ updated: 1 });
    expect(h.writeReportRun).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "agency-request-healthy-ci",
        runId: "run-123",
        title: "Build Healthy CI - completion",
        body: expect.stringMatching(
          /Type:\*\* agency-request-completion[\s\S]*Delivery state:\*\* proposed[\s\S]*Draft PR #42 is green[\s\S]*https:\/\/github.com\/acme\/widgets\/pull\/42/,
        ),
      }),
    );
    expect(h.writeTodoFile).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "healthy-ci",
        description: expect.stringContaining(
          "[Open the completion report](/reports/agency-request-healthy-ci)",
        ),
        items: [expect.objectContaining({ completed: true })],
        agencyRequest: expect.objectContaining({
          phase: "done",
          related: expect.arrayContaining([
            { kind: "report", id: "agency-request-healthy-ci" },
          ]),
        }),
      }),
    );
  });
});
