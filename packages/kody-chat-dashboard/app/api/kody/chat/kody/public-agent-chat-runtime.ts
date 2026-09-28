import { generateText, type ToolSet } from "ai";

import {
  buildPublicAgentChildSystem,
  buildPublicAgentSynthesisInput,
  buildPublicAgentReference,
  requiresPublicAgentToolEvidence,
  runIsolatedPublicAgentTaskWithRetry,
  synthesizePublicAgentResponse,
  isCompleteProjectAssessmentAssignments,
  PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX,
  retryProjectAssessmentSynthesis,
} from "./public-agent-delegation";
import type { PublicDelegationAgent } from "./public-agent-definition";
import {
  handlePublicAgentChat,
  type PublicAgentChatResult,
} from "./public-agent-chat-handler";
import { presentPublicAgentResponse } from "./public-agent-presentation";
import {
  orchestratePublicAgentTurn,
  type PublicAgentCapability,
} from "./public-agent-orchestrator";
import {
  routePublicAgentTask,
  type PublicAgentRouteDecision,
} from "./public-agent-routing";
import type { DurableTurn } from "../durable-turn";
import type { ProjectAssessmentSynthesisRecovery } from "../durable-turn";
import {
  INVALID_PROJECT_ASSESSMENT_MESSAGE,
  projectAssessmentBody,
  projectAssessmentTitle,
  validateProjectAssessmentReport,
} from "./project-assessment-report";

export {
  PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX,
  retryProjectAssessmentSynthesis,
};

interface PublicAgentTelemetry {
  traceId: string;
  startedAt: number;
  formatError(error: unknown): string;
  clearContext(): void;
  log(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

interface HandleConfiguredPublicAgentChatOptions {
  userText: string;
  conversationContext?: string;
  assignedAgents: readonly PublicDelegationAgent[];
  model: Parameters<typeof generateText>[0]["model"];
  availableTools: Record<string, unknown>;
  specialistTools: Record<string, unknown>;
  outputToolNames: readonly string[];
  loadCapabilities(
    agent: PublicDelegationAgent,
  ): Promise<PublicAgentCapability[]>;
  wrapTool(name: string, candidate: unknown): unknown;
  repository?: { owner: string; repo: string } | null;
  maxSteps: number;
  providerCapabilities: {
    supportsRequiredToolChoice: boolean;
    supportsNamedToolChoice?: boolean;
  };
  requireViewOutput: boolean;
  routeDecision?: PublicAgentRouteDecision;
  startDurableTurn?: () => Pick<
    DurableTurn,
    "recordProgress" | "saveRecovery" | "complete" | "fail"
  >;
  telemetry: PublicAgentTelemetry;
}

type ConfiguredPublicAgentExecutionOptions = Pick<
  HandleConfiguredPublicAgentChatOptions,
  | "assignedAgents"
  | "model"
  | "availableTools"
  | "specialistTools"
  | "loadCapabilities"
  | "repository"
  | "maxSteps"
  | "providerCapabilities"
> & {
  createToolExecutionScope(): (name: string, candidate: unknown) => unknown;
};

export async function runConfiguredPublicAgentAssignments({
  assignments,
  sharedContext,
  abortSignal,
  ...options
}: ConfiguredPublicAgentExecutionOptions & {
  assignments: Extract<
    PublicAgentRouteDecision,
    { mode: "delegate" }
  >["assignments"];
  sharedContext?: string;
  abortSignal?: AbortSignal;
}) {
  const { results } = await orchestratePublicAgentTurn({
    userText: sharedContext ?? "",
    assignedAgents: options.assignedAgents,
    availableTools: options.availableTools,
    specialistTools: options.specialistTools,
    outputToolNames: [],
    loadCapabilities: options.loadCapabilities,
    route: async () => ({ mode: "delegate", assignments }),
    invoke: async ({ agent, task, capabilities, tools }) => {
      const wrapTool = options.createToolExecutionScope();
      const wrappedTools = Object.fromEntries(
        Object.entries(tools).map(([name, candidate]) => [
          name,
          wrapTool(name, candidate),
        ]),
      );
      const capabilityInstructions = capabilities.map(
        (capability) => capability.instructions,
      );
      return runIsolatedPublicAgentTaskWithRetry({
        agent,
        task,
        ...(sharedContext ? { sharedContext } : {}),
        reference: buildPublicAgentReference({
          agent,
          capabilityInstructions,
          capabilityToolNames: capabilities.flatMap((capability) =>
            capability.capabilityTools.map((tool) => tool.name),
          ),
        }),
        system: buildPublicAgentChildSystem({
          agent,
          capabilityInstructions,
          repository: options.repository,
        }),
        model: options.model,
        tools: wrappedTools as ToolSet,
        maxSteps: options.maxSteps,
        abortSignal,
        executionMode: "generate",
        requireToolEvidence: requiresPublicAgentToolEvidence(task),
        providerCapabilities: options.providerCapabilities,
      });
    },
  });
  return results;
}

interface PublishTool {
  execute?: (input: {
    slug: string;
    title: string;
    body: string;
  }) => Promise<unknown> | unknown;
}

export async function publishProjectAssessmentReport({
  answer,
  repository,
  publishTool,
}: {
  answer: string;
  repository?: { owner: string; repo: string } | null;
  publishTool?: PublishTool | null;
}): Promise<{ answer: string; published: boolean }> {
  if (!repository || typeof publishTool?.execute !== "function") {
    return { answer, published: false };
  }
  if (
    !answer.trim() ||
    answer.startsWith(PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX) ||
    answer.trim() ===
      "I could not prepare a reliable answer from the available specialist evidence. Would you like me to retry or use another model?"
  ) {
    return { answer, published: false };
  }
  const validation = validateProjectAssessmentReport({ text: answer });
  if (!validation.valid) {
    return {
      answer: INVALID_PROJECT_ASSESSMENT_MESSAGE,
      published: false,
    };
  }
  const title = projectAssessmentTitle(answer);
  if (!title) {
    return { answer: INVALID_PROJECT_ASSESSMENT_MESSAGE, published: false };
  }
  try {
    const result = await publishTool.execute({
      slug: "project-assessment",
      title,
      body: projectAssessmentBody(answer),
    });
    if (
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
    ) {
      return { answer, published: false };
    }
    const href = `/repo/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/reports/project-assessment`;
    return {
      answer: `${answer.trim()}\n\n[Open the saved project assessment](${href})`,
      published: true,
    };
  } catch {
    return { answer, published: false };
  }
}

/** Adapts configured Agents, Capabilities, and tools to the specialist chat protocol. */
export async function handleConfiguredPublicAgentChat({
  userText,
  conversationContext,
  assignedAgents,
  model,
  availableTools,
  specialistTools,
  outputToolNames,
  loadCapabilities,
  wrapTool,
  repository,
  maxSteps,
  providerCapabilities,
  requireViewOutput,
  routeDecision,
  startDurableTurn,
  telemetry,
}: HandleConfiguredPublicAgentChatOptions): Promise<PublicAgentChatResult> {
  const { traceId } = telemetry;
  return handlePublicAgentChat({
    traceId,
    assignedAgents,
    route: () =>
      routeDecision
        ? Promise.resolve(routeDecision)
        : routePublicAgentTask({
            userText,
            conversationContext,
            assignedAgents,
            model,
          }),
    orchestrate: (decision, onReasoningDelta) =>
      orchestratePublicAgentTurn({
        userText,
        assignedAgents,
        availableTools,
        specialistTools,
        outputToolNames,
        loadCapabilities,
        route: async () => decision,
        invoke: async ({
          agent,
          task,
          assignmentIndex,
          capabilities,
          tools,
        }) => {
          const wrappedTools = Object.fromEntries(
            Object.entries(tools).map(([name, candidate]) => [
              name,
              wrapTool(name, candidate),
            ]),
          );
          const capabilityInstructions = capabilities.map(
            (capability) => capability.instructions,
          );
          return runIsolatedPublicAgentTaskWithRetry({
            agent,
            task,
            ...(userText.includes("<view_result>")
              ? { sharedContext: userText }
              : {}),
            reference: buildPublicAgentReference({
              agent,
              capabilityInstructions,
              capabilityToolNames: capabilities.flatMap((capability) =>
                capability.capabilityTools.map((tool) => tool.name),
              ),
            }),
            system: buildPublicAgentChildSystem({
              agent,
              capabilityInstructions,
              repository,
            }),
            model,
            tools: wrappedTools as ToolSet,
            maxSteps,
            requireToolEvidence: requiresPublicAgentToolEvidence(task),
            providerCapabilities,
            onReasoningDelta: (delta) =>
              onReasoningDelta({
                agent: agent.slug,
                assignmentIndex,
                delta,
              }),
          });
        },
      }),
    synthesize: async (decision, results) => {
      const answer = await synthesizePublicAgentResponse({
        userText,
        assignments: decision.assignments,
        assignedAgents,
        results,
        model,
        onSynthesisFailure: (error) =>
          telemetry.error(
            { traceId, err: telemetry.formatError(error) },
            "kody-direct: specialist synthesis failed",
          ),
      });
      if (!isCompleteProjectAssessmentAssignments(decision.assignments)) {
        return answer;
      }
      const published = await publishProjectAssessmentReport({
        answer,
        repository,
        publishTool: specialistTools.publish_report as PublishTool | undefined,
      });
      return published.answer;
    },
    buildRecovery: (
      decision,
      results,
    ): ProjectAssessmentSynthesisRecovery | null => {
      if (
        !isCompleteProjectAssessmentAssignments(decision.assignments) ||
        !repository
      ) {
        return null;
      }
      const input = buildPublicAgentSynthesisInput({
        userText,
        assignments: decision.assignments,
        assignedAgents,
        results,
      });
      const userMessage = input.messages[0]?.content;
      if (typeof userMessage !== "string") return null;
      return {
        kind: "project-assessment-synthesis",
        version: 1,
        system: input.system,
        userMessage,
        internalLinks: results.flatMap((result) => result.internalLinks ?? []),
        repository,
        createdAt: new Date().toISOString(),
      };
    },
    present: (decision, results, parentTools, writer) => {
      if (isCompleteProjectAssessmentAssignments(decision.assignments)) {
        return Promise.resolve(null);
      }
      return presentPublicAgentResponse({
        userText,
        assignments: decision.assignments,
        assignedAgents,
        results,
        model,
        tools: Object.fromEntries(
          Object.entries(parentTools).map(([name, candidate]) => [
            name,
            wrapTool(name, candidate),
          ]),
        ),
        writer,
        providerCapabilities,
        requireViewOutput,
      });
    },
    startDurableTurn,
    formatStreamError: (error) =>
      `[trace ${traceId}] ${telemetry.formatError(error)}`,
    onDurableStartFailure: (error) =>
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: durable specialist turn setup failed",
      ),
    onDurableCompleteFailure: (error) =>
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: durable specialist completion failed",
      ),
    onDurableFailFailure: (error) =>
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: durable specialist failure write failed",
      ),
    onOrchestrationComplete: (decision, childSessionIds) =>
      telemetry.log(
        {
          traceId,
          mode: decision.mode,
          agents:
            decision.mode === "delegate"
              ? decision.assignments.map((assignment) => assignment.agent)
              : [],
          childSessions: childSessionIds,
        },
        "kody-direct: specialist routing completed",
      ),
    onOrchestrationFailure: (error) =>
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: specialist orchestration failed",
      ),
    onSpecialistFailure: (result) =>
      telemetry.warn(
        {
          traceId,
          agent: result.agent,
          childSession: result.sessionId,
          failureCode: result.failure.code,
          err: result.failure.detail,
        },
        "kody-direct: specialist task failed",
      ),
    onSynthesisFailure: (error) =>
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: specialist synthesis failed",
      ),
    onFinished: (outcome) => {
      telemetry.clearContext();
      telemetry.log(
        { traceId, totalDuration: Date.now() - telemetry.startedAt },
        outcome.synthesisFailed
          ? "kody-direct: specialist synthesis failure returned"
          : outcome.returnedFailure
            ? "kody-direct: specialist failure returned"
            : "kody-direct: synthesized specialist result",
      );
    },
    onStreamError: (error) => {
      telemetry.clearContext();
      telemetry.error(
        { traceId, err: telemetry.formatError(error) },
        "kody-direct: specialist stream failed",
      );
    },
  });
}
