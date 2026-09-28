import { randomUUID } from "node:crypto";
import { generateText, stepCountIs, type ToolSet } from "ai";

import {
  CHAT_OUTPUT_CONTRACT_DATA_TYPE,
  EXCLUSIVE_TOOL_OUTPUT_MODE,
  FINAL_ANSWER_FOLLOW_UP_ERROR,
  FINAL_ANSWER_TOOL,
  finalAnswerRequestsInteraction,
  getFinalAnswerContent,
  getToolErrorMessage,
  isToolErrorOutput,
  SHOW_VIEW_TOOL,
  selectChatOutputToolChoice,
} from "../../../../../src/dashboard/lib/chat-output-tools";
import { FOLLOW_UP_QUESTION_CONTRACT } from "../../../../../src/dashboard/lib/chat-defaults/defaults";
import {
  buildPublicAgentSynthesisInput,
  appendPublicAgentInternalLinks,
  formatPublicAgentResponse,
  parsePublicAgentGeneratedAnswer,
  PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE,
  type PublicAgentTaskResult,
} from "./public-agent-delegation";
import type { PublicDelegationAgent } from "./public-agent-definition";
import type { PublicAgentAssignment } from "./public-agent-routing";
import type { PublicAgentResponseWriter } from "./public-agent-response";
import { APPROVAL_REQUIRED_TOOL_NAMES } from "../tools/tool-action-approval";

const PUBLIC_AGENT_PRESENTATION_TIMEOUT_MS = 25_000;
const INTERACTIVE_PRESENTATION_TEXT = "Interactive response presented.";
const INTERACTIVE_PRESENTATION_FAILURE =
  "I couldn't open the required interaction. Please retry.";
const OUTPUT_TOOL_NAMES = new Set<string>([FINAL_ANSWER_TOOL, SHOW_VIEW_TOOL]);

interface PresentationToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

interface PresentationToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

function creationFormInput(userText: string): Record<string, unknown> | null {
  const match =
    /\b(?:create|add)\s+(?:(?:a|an)\s+)?(?:new\s+)?([a-z][a-z0-9-]*(?:\s+(?!for\b|with\b|called\b|named\b)[a-z][a-z0-9-]*)?)/i.exec(
      userText,
    );
  const subject = match?.[1]?.trim();
  if (!subject) return null;
  const title = subject
    .split(/\s+/)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
  return {
    root: "form",
    elements: {
      form: {
        type: "GuidedForm",
        props: {
          title: `Create ${title}`,
          fields: [{ name: "name", label: "Name", value: "" }],
          submitLabel: "Create",
        },
      },
    },
  };
}

async function renderCreationFallback({
  userText,
  presentationTools,
  writer,
}: {
  userText: string;
  presentationTools: ToolSet;
  writer: PublicAgentResponseWriter;
}): Promise<boolean> {
  const input = creationFormInput(userText);
  const showView = presentationTools[SHOW_VIEW_TOOL] as
    { execute?: (value: unknown) => Promise<unknown> } | undefined;
  if (!input || !showView?.execute) return false;
  const output = await showView.execute(input);
  if (isToolErrorOutput(output)) return false;
  const toolCallId = `specialist-form-${randomUUID()}`;
  writer.write({
    type: CHAT_OUTPUT_CONTRACT_DATA_TYPE,
    data: { mode: EXCLUSIVE_TOOL_OUTPUT_MODE },
  });
  writer.write({
    type: "tool-input-available",
    toolCallId,
    toolName: SHOW_VIEW_TOOL,
    input,
  });
  writer.write({ type: "tool-output-available", toolCallId, output });
  return true;
}

export async function presentPublicAgentResponse({
  userText,
  assignments,
  assignedAgents,
  results,
  model,
  tools,
  writer,
  providerCapabilities,
  requireViewOutput,
  generate = generateText,
}: {
  userText: string;
  assignments: readonly PublicAgentAssignment[];
  assignedAgents: readonly PublicDelegationAgent[];
  results: readonly PublicAgentTaskResult[];
  model: Parameters<typeof generateText>[0]["model"];
  tools: Record<string, unknown>;
  writer: PublicAgentResponseWriter;
  providerCapabilities: {
    supportsRequiredToolChoice: boolean;
    supportsNamedToolChoice?: boolean;
  };
  requireViewOutput: boolean;
  generate?: typeof generateText;
}): Promise<string> {
  const { system, messages, groundedSpecialistFallback } =
    buildPublicAgentSynthesisInput({
      userText,
      assignments,
      assignedAgents,
      results,
    });
  const presentationMessages = requireViewOutput
    ? [
        {
          role: "user" as const,
          content: [
            "## User request",
            userText,
            "## Specialist conclusions",
            ...results.map(
              (result) =>
                `${result.agent}: ${
                  result.status === "completed"
                    ? (result.result ?? "").trim().slice(0, 2_000) ||
                      "No usable conclusion was returned."
                    : "No usable conclusion was returned."
                }`,
            ),
          ].join("\n\n"),
        },
      ]
    : messages;
  const presentationTools = Object.fromEntries(
    Object.entries(tools).filter(
      ([name]) =>
        APPROVAL_REQUIRED_TOOL_NAMES.has(name) ||
        (OUTPUT_TOOL_NAMES.has(name) &&
          (!requireViewOutput || name === SHOW_VIEW_TOOL)),
    ),
  ) as ToolSet;
  if (Object.keys(presentationTools).length === 0) {
    throw new Error("Parent presentation tools are unavailable");
  }
  const hasApprovalProtectedAction = Object.keys(presentationTools).some(
    (name) => APPROVAL_REQUIRED_TOOL_NAMES.has(name),
  );

  if (
    requireViewOutput &&
    !hasApprovalProtectedAction &&
    !providerCapabilities.supportsRequiredToolChoice &&
    providerCapabilities.supportsNamedToolChoice !== true &&
    (await renderCreationFallback({ userText, presentationTools, writer }))
  ) {
    return INTERACTIVE_PRESENTATION_TEXT;
  }

  let response: Awaited<ReturnType<typeof generateText>>;
  try {
    response = await generate({
      model,
      abortSignal: AbortSignal.timeout(PUBLIC_AGENT_PRESENTATION_TIMEOUT_MS),
      system: [
        system,
        "Finish through the available parent presentation tools.",
        "Use show_view whenever the response needs missing information, confirmation, choice, or editable values from the user.",
        "When a creation request is missing required values, render the smallest suitable editable form with a clear submit action instead of asking for those values in plain text.",
        "When the user explicitly asks to perform a prepared action and the specialist evidence provides the required values, call the matching approval-protected action. Do not ask for approval in prose; the action opens the bound approval card.",
        "Use final_answer only when the response is complete and needs no user interaction.",
        "Never expose configured action names, tool names, routing, or delegation to the user.",
      ].join("\n"),
      messages: presentationMessages,
      tools: presentationTools,
      toolChoice: selectChatOutputToolChoice(
        Object.keys(presentationTools),
        providerCapabilities,
      ),
      prepareStep: ({ steps }) => {
        const finalAnswerErrors = steps.flatMap((step) =>
          (step.toolResults ?? []).flatMap((result) =>
            result.toolName === FINAL_ANSWER_TOOL
              ? [getToolErrorMessage(result.output)]
              : [],
          ),
        );
        if (finalAnswerErrors.includes(FINAL_ANSWER_FOLLOW_UP_ERROR)) {
          return {
            activeTools: [FINAL_ANSWER_TOOL],
            toolChoice: selectChatOutputToolChoice(
              [FINAL_ANSWER_TOOL],
              providerCapabilities,
            ),
            system: [
              system,
              `Your final_answer was rejected because it had no follow-up question. ${FOLLOW_UP_QUESTION_CONTRACT} Do not call show_view for this correction.`,
            ].join("\n"),
          };
        }
        if (!finalAnswerErrors.some(Boolean)) {
          return {};
        }
        return {
          activeTools: [SHOW_VIEW_TOOL],
          toolChoice: selectChatOutputToolChoice(
            [SHOW_VIEW_TOOL],
            providerCapabilities,
          ),
          system: [
            system,
            "Your final_answer was rejected because it still asked the user for input. Call show_view now with the smallest valid interactive form, choice, or confirmation. Do not call final_answer again.",
          ].join("\n"),
        };
      },
      stopWhen: stepCountIs(4),
      maxOutputTokens: 1_200,
    });
  } catch (error) {
    if (
      requireViewOutput &&
      !hasApprovalProtectedAction &&
      (await renderCreationFallback({ userText, presentationTools, writer }))
    ) {
      return INTERACTIVE_PRESENTATION_TEXT;
    }
    throw error;
  }

  const steps = (response.steps ?? []) as Array<{
    toolCalls?: PresentationToolCall[];
    toolResults?: PresentationToolResult[];
  }>;
  const callsById = new Map(
    steps
      .flatMap((step) => step.toolCalls ?? [])
      .map((call) => [call.toolCallId, call] as const),
  );
  const successfulResults = steps
    .flatMap((step) => step.toolResults ?? [])
    .filter(
      (result) =>
        (result.toolName === FINAL_ANSWER_TOOL ||
          result.toolName === SHOW_VIEW_TOOL ||
          APPROVAL_REQUIRED_TOOL_NAMES.has(result.toolName)) &&
        !isToolErrorOutput(result.output),
    );
  const presentedResults = successfulResults.flatMap((result) => {
    const call = callsById.get(result.toolCallId);
    return call ? [{ call, result }] : [];
  });

  if (presentedResults.length > 0) {
    const finalPresentedResult = presentedResults.at(-1)!;
    writer.write({
      type: CHAT_OUTPUT_CONTRACT_DATA_TYPE,
      data: { mode: EXCLUSIVE_TOOL_OUTPUT_MODE },
    });
    writer.write({
      type: "tool-input-available",
      toolCallId: finalPresentedResult.call.toolCallId,
      toolName: finalPresentedResult.call.toolName,
      input: finalPresentedResult.call.input,
    });
    writer.write({
      type: "tool-output-available",
      toolCallId: finalPresentedResult.result.toolCallId,
      output: finalPresentedResult.result.output,
    });
    const finalAnswer = getFinalAnswerContent(
      finalPresentedResult.result.output,
    );
    return finalAnswer ?? INTERACTIVE_PRESENTATION_TEXT;
  }

  if (
    requireViewOutput &&
    !hasApprovalProtectedAction &&
    (await renderCreationFallback({ userText, presentationTools, writer }))
  ) {
    return INTERACTIVE_PRESENTATION_TEXT;
  }

  const candidateAnswer =
    parsePublicAgentGeneratedAnswer(response.text ?? "") ||
    groundedSpecialistFallback ||
    PUBLIC_AGENT_SYNTHESIS_FAILURE_MESSAGE;
  const answer = appendPublicAgentInternalLinks(
    formatPublicAgentResponse({
      answer: finalAnswerRequestsInteraction(candidateAnswer)
        ? INTERACTIVE_PRESENTATION_FAILURE
        : candidateAnswer,
      assignments,
      assignedAgents,
    }),
    results,
  );
  const messageId = `specialist-presentation-${randomUUID()}`;
  writer.write({ type: "text-start", id: messageId });
  writer.write({ type: "text-delta", id: messageId, delta: answer });
  writer.write({ type: "text-end", id: messageId });
  return answer;
}
