import "server-only";

import type { Octokit } from "@octokit/rest";
import { readOperators } from "@kody-ade/base/engine/config";
import { appendInboxFeed } from "@dashboard/lib/inbox/feed-server";
import type { InboxFeedEntry } from "@dashboard/lib/inbox/feed";

interface WorkflowInboxAlert {
  owner: string;
  repo: string;
  workflowId: string;
  runId: string;
  summary: string;
  url: string;
  octokit: Octokit;
}

interface PipelineApprovalRequest {
  owner: string;
  repo: string;
  pipelineId: string;
  runId: string;
  issue?: number;
  summary: string;
  url: string;
  octokit: Octokit;
}

function workflowLabel(workflowId: string): string {
  return workflowId
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export async function deliverWorkflowInboxAlert(
  input: WorkflowInboxAlert,
): Promise<number> {
  const operators = await readOperators(input.octokit, input.owner, input.repo);
  if (operators.length === 0) return 0;

  const repoFullName = `${input.owner}/${input.repo}`;
  const sentAt = new Date().toISOString();
  const entries: InboxFeedEntry[] = operators.map((operator) => {
    const login = operator.toLowerCase();
    return {
      id: `kody-workflow:${login}:${input.workflowId}:${input.runId}`,
      login,
      source: "kody",
      repoFullName,
      threadType: "Workflow",
      title: `${workflowLabel(input.workflowId)} needs attention`,
      snippet: input.summary.slice(0, 400),
      author: "Kody",
      url: input.url,
      sentAt,
    };
  });

  return appendInboxFeed(entries);
}

export async function deliverPipelineApprovalRequest(
  input: PipelineApprovalRequest,
): Promise<number> {
  const operators = await readOperators(input.octokit, input.owner, input.repo);
  if (operators.length === 0) return 0;
  const repoFullName = `${input.owner}/${input.repo}`;
  const sentAt = new Date().toISOString();
  return appendInboxFeed(
    operators.map((operator) => ({
      id: `kody-pipeline-approval:${operator.toLowerCase()}:${input.pipelineId}:${input.runId}`,
      login: operator.toLowerCase(),
      source: "request" as const,
      repoFullName,
      threadType: input.issue ? "Issue" : "Pipeline",
      title: `${workflowLabel(input.pipelineId)} needs approval`,
      snippet: input.summary.slice(0, 400),
      author: "Kody",
      url: input.url,
      sentAt,
      pipelineApproval: {
        pipelineId: input.pipelineId,
        runId: input.runId,
        ...(input.issue ? { issue: input.issue } : {}),
      },
      ...(input.issue
        ? {
            ctoAction: "request",
            ctoAgent: "qa",
            ctoCapability: input.pipelineId,
          }
        : {}),
    })),
  );
}
