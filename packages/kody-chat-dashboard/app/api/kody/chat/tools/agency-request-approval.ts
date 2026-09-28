import type { RenderedViewDirective } from "../../../../../src/dashboard/lib/chat-ui-actions";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { getBuiltinViewRendererDefinition } from "../../../../../src/dashboard/lib/view-renderers/builtin";
import { buildRenderedViewDirective } from "../../../../../src/dashboard/lib/view-renderers/template";
import { buildDecisionBody } from "./tool-action-approval";

export interface AgencyRequestDecisionContext {
  /** Plain sentence describing what is currently true before the request runs. */
  currentState: string;
  /** Plain sentence explaining why a decision is needed now. */
  whyNow: string;
  /** Plain sentence describing what will happen if approved. */
  recommendedAction: string;
  /** Plain sentence describing what will happen if cancelled. */
  cancelChoice: string;
}

export function createAgencyRequestApproval(input: {
  todoSlug: string;
  decisionContext?: AgencyRequestDecisionContext;
}): RenderedViewDirective {
  const definition = getBuiltinViewRendererDefinition("approval-card");
  if (!definition) throw new Error("Approval card renderer is unavailable");
  const body = buildDecisionBody({
    ...input.decisionContext,
    legacyBody:
      "Kody saved the verified plan and boundaries on the Agency request Todo. Approve to begin execution, or cancel to leave it waiting for approval.",
  });
  return buildRenderedViewDirective({
    id: `agency-request-${input.todoSlug}`,
    definition,
    data: {
      title: "Approve this Agency plan?",
      body,
    },
  });
}

export function showAgencyRequestApprovalDirectly(input: {
  todoSlug: string;
}): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const toolCallId = `agency-assessment-${input.todoSlug}`;
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "show_view",
        input: { purpose: "approval-card" },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: createAgencyRequestApproval(input),
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export function readAgencyRequestApproval(
  latestUserText: string | null,
): { action: "approve" | "cancel"; todoSlug: string } | null {
  if (!latestUserText) return null;
  const match = latestUserText.match(/<view_result>([\s\S]*?)<\/view_result>/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Record<string, unknown>;
    if (
      value.kind !== "view_result" ||
      value.view !== "renderer" ||
      value.rendererSlug !== "approval-card" ||
      (value.actionId !== "approve" && value.actionId !== "cancel") ||
      typeof value.viewId !== "string"
    ) {
      return null;
    }
    const id = /^agency-request-([a-z0-9][a-z0-9_-]{0,63})$/.exec(value.viewId);
    return id
      ? {
          action: value.actionId as "approve" | "cancel",
          todoSlug: id[1],
        }
      : null;
  } catch {
    return null;
  }
}

export async function runApprovedAgencyRequestDirectly({
  approval,
  runAgencyRequest,
}: {
  approval: { action: "approve" | "cancel"; todoSlug: string };
  runAgencyRequest(slug: string): Promise<Record<string, unknown>>;
}): Promise<Response> {
  const result =
    approval.action === "approve"
      ? await runAgencyRequest(approval.todoSlug)
      : { kind: "cancelled" };
  const failed = typeof result.error === "string";
  const runId = typeof result.runId === "string" ? result.runId : null;
  const content =
    approval.action === "cancel"
      ? "Agency request remains waiting for approval."
      : failed
        ? `Agency request could not start: ${typeof result.message === "string" ? result.message : result.error}`
        : runId
          ? `Agency request is monitoring workflow run ${runId}.`
          : "Agency request started and is being monitored.";
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const toolCallId = `agency-approval-${approval.todoSlug}`;
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "final_answer",
        input: { content },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: { content },
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
