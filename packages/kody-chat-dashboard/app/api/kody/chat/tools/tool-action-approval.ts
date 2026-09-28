import { createHmac, timingSafeEqual } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

import type { RenderedViewDirective } from "../../../../../src/dashboard/lib/chat-ui-actions";
import { getBuiltinViewRendererDefinition } from "../../../../../src/dashboard/lib/view-renderers/builtin";
import { buildRenderedViewDirective } from "../../../../../src/dashboard/lib/view-renderers/template";

const TOKEN_PREFIX = "kody-action";
const TOKEN_TTL_MS = 15 * 60 * 1_000;

export interface ToolActionApprovalContext {
  owner: string;
  repo: string;
  actorId: string;
}

export interface ToolActionDecisionContext {
  /** Plain sentence describing what is currently true before the action runs. */
  currentState: string;
  /** Plain sentence explaining why a decision is needed now. */
  whyNow: string;
  /** Plain sentence describing what will happen if approved. */
  recommendedAction: string;
  /** Plain sentence describing what will happen if cancelled. */
  cancelChoice: string;
  /** Kody's recommendation, when one is useful for this decision. */
  recommendation?: string;
  /** The tradeoff of Kody's recommendation, when one is useful. */
  tradeoff?: string;
}

interface ToolActionPayload extends ToolActionApprovalContext {
  toolName: string;
  input: unknown;
  issuedAt: number;
}

export interface ToolActionApproval {
  action: "approve" | "cancel";
  toolName: string;
  input: unknown;
}

type ExecutableTool = {
  execute?: (input: unknown) => Promise<unknown> | unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const APPROVAL_REQUIRED_TOOL_NAMES = new Set([
  "create_feature",
  "create_enhancement",
  "create_refactor",
  "create_documentation",
  "create_chore",
  "report_bug",
  "create_or_update_capability",
  "copy_capability",
  "create_kody_agent",
  "create_or_update_workflow",
  "configure_kody",
  "guided_flow_create",
  "create_app",
  "manage_app",
  "update_app",
]);

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

function encodePayload(payload: ToolActionPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const encodedSignature = signature(encodedPayload, secret).toString(
    "base64url",
  );
  return `${TOKEN_PREFIX}.${encodedPayload}.${encodedSignature}`;
}

function decodePayload(
  token: string,
  secret: string,
): ToolActionPayload | null {
  const [prefix, encodedPayload, encodedSignature, extra] = token.split(".");
  if (
    prefix !== TOKEN_PREFIX ||
    !encodedPayload ||
    !encodedSignature ||
    extra !== undefined
  ) {
    return null;
  }
  const expected = signature(encodedPayload, secret);
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const value = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<ToolActionPayload>;
    if (
      typeof value.owner !== "string" ||
      typeof value.repo !== "string" ||
      typeof value.actorId !== "string" ||
      typeof value.toolName !== "string" ||
      typeof value.issuedAt !== "number" ||
      !("input" in value)
    ) {
      return null;
    }
    return value as ToolActionPayload;
  } catch {
    return null;
  }
}

/** Format the user-facing context for a decision shared by approval cards. */
export function buildDecisionBody(input: {
  currentState?: string;
  whyNow?: string;
  recommendedAction?: string;
  cancelChoice?: string;
  recommendation?: string;
  tradeoff?: string;
  legacyBody: string;
}): string {
  const parts: string[] = [];
  if (input.currentState) parts.push(`**Current:** ${input.currentState}`);
  if (input.whyNow) parts.push(`**Why:** ${input.whyNow}`);
  if (input.recommendedAction) {
    parts.push(`**Approving will:** ${input.recommendedAction}`);
  }
  if (input.cancelChoice) {
    parts.push(`**Cancelling will:** ${input.cancelChoice}`);
  }
  if (input.recommendation) {
    parts.push(`**Recommendation:** ${input.recommendation}`);
  }
  if (input.tradeoff) parts.push(`**Tradeoff:** ${input.tradeoff}`);
  return parts.length > 0 ? parts.join("\n\n") : input.legacyBody;
}

export function createToolActionApproval(input: {
  secret: string;
  context: ToolActionApprovalContext;
  toolName: string;
  input: unknown;
  title: string;
  body?: string;
  decisionContext?: ToolActionDecisionContext;
  now?: number;
}): RenderedViewDirective {
  const definition = getBuiltinViewRendererDefinition("approval-card");
  if (!definition) throw new Error("Approval card renderer is unavailable");
  return buildRenderedViewDirective({
    id: encodePayload(
      {
        ...input.context,
        toolName: input.toolName,
        input: input.input,
        issuedAt: input.now ?? Date.now(),
      },
      input.secret,
    ),
    definition,
    data: {
      title: input.title,
      body: buildDecisionBody({
        ...input.decisionContext,
        legacyBody:
          input.body ??
          "Approve to run this exact saved action, or cancel to leave everything unchanged.",
      }),
    },
  });
}

export function readToolActionApproval(
  latestUserText: string | null,
  input: {
    secret: string;
    context: ToolActionApprovalContext;
    now?: number;
  },
): ToolActionApproval | null {
  if (!latestUserText) return null;
  const match = latestUserText.match(/<view_result>([\s\S]*?)<\/view_result>/);
  if (!match) return null;
  try {
    const result = JSON.parse(match[1]) as Record<string, unknown>;
    if (
      result.kind !== "view_result" ||
      result.view !== "renderer" ||
      result.rendererSlug !== "approval-card" ||
      (result.actionId !== "approve" && result.actionId !== "cancel") ||
      typeof result.viewId !== "string"
    ) {
      return null;
    }
    const payload = decodePayload(result.viewId, input.secret);
    const now = input.now ?? Date.now();
    if (
      !payload ||
      payload.owner !== input.context.owner ||
      payload.repo !== input.context.repo ||
      payload.actorId !== input.context.actorId ||
      payload.issuedAt > now ||
      now - payload.issuedAt > TOKEN_TTL_MS
    ) {
      return null;
    }
    return {
      action: result.actionId as "approve" | "cancel",
      toolName: payload.toolName,
      input: payload.input,
    };
  } catch {
    return null;
  }
}

export async function runApprovedToolAction(
  approval: ToolActionApproval | null,
  tools: Record<string, unknown>,
): Promise<
  | { action: "cancelled" }
  | { action: "approved"; toolName: string; input: unknown; output: unknown }
> {
  if (!approval) throw new Error("Approved action is invalid or expired");
  if (approval.action === "cancel") return { action: "cancelled" };
  const candidate = tools[approval.toolName];
  const execute =
    candidate && typeof candidate === "object"
      ? (candidate as ExecutableTool).execute
      : undefined;
  if (!execute) throw new Error("Approved action is no longer available");
  let output: unknown;
  try {
    output = await execute(approval.input);
  } catch (error) {
    output = {
      error: error instanceof Error ? error.message : "Approved action failed",
    };
  }
  return {
    action: "approved",
    toolName: approval.toolName,
    input: approval.input,
    output,
  };
}

export function approvedToolActionContent(result: {
  toolName: string;
  output: unknown;
}): string {
  const output = record(result.output) ?? {};
  const verification = record(output.verification);
  if (typeof output.error === "string") {
    return `Action failed: ${typeof output.message === "string" ? output.message : output.error}`;
  }
  if (typeof output.number === "number")
    return `Created task #${output.number}.`;
  if (result.toolName === "create_kody_agent") return "Agent created.";
  if (result.toolName === "create_or_update_workflow") return "Workflow saved.";
  if (
    result.toolName === "copy_capability" &&
    output.copied === true &&
    typeof output.slug === "string" &&
    typeof output.source === "string" &&
    typeof output.target === "string"
  ) {
    return `Copied ${output.slug} from ${output.source} to ${output.target} and verified the saved target.`;
  }
  if (result.toolName === "guided_flow_create") return "GuidedFlow saved.";
  if (result.toolName === "configure_kody" && verification) {
    const status = String(verification.status ?? "unverified");
    const runId = String(verification.runId ?? "").trim();
    const summary =
      typeof verification.summary === "string" ? verification.summary : null;
    return status === "success"
      ? `Configuration applied and verified.${runId ? ` First run ${runId} succeeded` : ""}${summary ? `: ${summary}` : "."}`
      : `Configuration saved, but the first run is ${status}${summary ? `: ${summary}` : "."}`;
  }
  return "Approved action completed.";
}

function actionTitle(toolName: string, input: unknown): string {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const name =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : typeof record.slug === "string"
          ? record.slug
          : typeof record.workflowId === "string"
            ? record.workflowId
            : typeof record.outcome === "string"
              ? record.outcome
              : "this action";
  if (toolName === "create_kody_agent") return `Create Agent ${name}?`;
  if (toolName === "configure_kody") return `Apply ${name}?`;
  if (toolName === "create_or_update_workflow") return `Save Workflow ${name}?`;
  if (toolName === "copy_capability") {
    const source = record.source ? recordKey(record.source) : null;
    const target = record.target ? recordKey(record.target) : null;
    const verb = record.overwrite === true ? "Replace" : "Copy";
    return source && target
      ? `${verb} ${name} from ${source} to ${target}?`
      : `${verb} ${name}?`;
  }
  if (toolName === "guided_flow_create") return `Save GuidedFlow ${name}?`;
  if (toolName === "create_app") return `Set up App ${name}?`;
  if (toolName === "manage_app")
    return `Run ${String(record.action ?? "action")} for App ${name}?`;
  if (toolName === "update_app") return `Update App ${name}?`;
  return `Create task ${name}?`;
}

function recordKey(value: unknown): string | null {
  const repository = record(value);
  return typeof repository?.owner === "string" &&
    typeof repository.repo === "string"
    ? `${repository.owner}/${repository.repo}`
    : null;
}

export function stageToolsForApproval(
  tools: Record<string, unknown>,
  input: {
    secret: string;
    context: ToolActionApprovalContext;
    decisionContext?: ToolActionDecisionContext;
  },
): Record<string, unknown> {
  // This boundary is shared by heterogeneous tools and runs before any tool
  // executes. It has no verified current state, why-now, or recommendation to
  // infer from arbitrary input, so callers must pass real context when they
  // have it; otherwise the concise fallback avoids inventing facts.
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, candidate]) => {
      if (
        !APPROVAL_REQUIRED_TOOL_NAMES.has(toolName) ||
        !candidate ||
        typeof candidate !== "object" ||
        typeof (candidate as ExecutableTool).execute !== "function"
      ) {
        return [toolName, candidate];
      }
      return [
        toolName,
        {
          ...candidate,
          execute: async (toolInput: unknown) =>
            createToolActionApproval({
              ...input,
              toolName,
              input: toolInput,
              title: actionTitle(toolName, toolInput),
              body: "Approve to run this exact saved action, or cancel to leave everything unchanged.",
            }),
        },
      ];
    }),
  );
}

export function createApprovedToolActionResponse(
  result:
    | { action: "cancelled" }
    | { action: "approved"; toolName: string; input: unknown; output: unknown },
): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      if (result.action === "cancelled") {
        const content = "Cancelled. Nothing was changed.";
        writer.write({
          type: "tool-input-available",
          toolCallId: "approved-action-cancelled",
          toolName: "final_answer",
          input: { content },
        });
        writer.write({
          type: "tool-output-available",
          toolCallId: "approved-action-cancelled",
          output: { content },
        });
        return;
      }
      const toolCallId = `approved-action-${result.toolName}`;
      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: result.toolName,
        input: result.input,
      });
      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: result.output,
      });
      const record =
        result.output &&
        typeof result.output === "object" &&
        !Array.isArray(result.output)
          ? (result.output as Record<string, unknown>)
          : {};
      const content = approvedToolActionContent({
        toolName: result.toolName,
        output: record,
      });
      writer.write({
        type: "tool-input-available",
        toolCallId: `${toolCallId}-answer`,
        toolName: "final_answer",
        input: { content },
      });
      writer.write({
        type: "tool-output-available",
        toolCallId: `${toolCallId}-answer`,
        output: { content },
      });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
