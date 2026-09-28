/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern direct-llm-stream
 *
 * POST /api/kody/chat/kody
 *
 * In-process chat endpoint for the "Kody" agent. Streams replies directly
 * from the configured chat model using the Vercel AI SDK.
 * No GitHub Actions, no VPS, no runner cold start — the request goes
 * straight from the Vercel function to the model and back.
 *
 * Body: {
 *   messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
 *   model?: string   // optional provider-specific model id override
 * }
 *
 * Response: text/plain stream of the assistant reply (AI SDK text stream
 * protocol — client accumulates chunks into the assistant bubble).
 */

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  streamText,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
  tool,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from "ai";
import { getChatServerToolRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-tools";
import { getFeatureGuideRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-feature-guides";
import { formatFeatureGuidePromptSection } from "@kody-ade/kody-chat-dashboard/platform/feature-guide-context";
import {
  resolveSurfaceScope,
  CLIENT_SURFACE_TOOL_ALLOWLIST,
} from "@kody-ade/kody-chat-dashboard/platform/surface-scope";
import type {
  ChatPluginToolDefinition,
  ChatToolServerContext,
} from "@kody-ade/kody-chat-dashboard/platform";
import {
  getAgent,
  isValidAgentId,
  type AgentConfig,
  type AgentId,
} from "../../../../../src/dashboard/lib/agents";
import { applyVoiceOverlay } from "../../../../../src/dashboard/lib/voice/overlay";
import {
  requireUserAuth,
  getRequestAuth,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  type RequestAuth,
} from "@kody-ade/base/auth";
import type { KodyRepositoryCredential } from "@kody-ade/base/auth/request-user-provider";
import { verifyOperatorActor } from "../../../../../src/dashboard/lib/auth/operator-actor";
import { getChatRequestContextProvider } from "@kody-ade/kody-chat-dashboard/chat/request-context-provider";
import { buildKodyAuthHeaders } from "@kody-ade/base/auth-headers";
import {
  createUserOctokit,
  setGitHubContext,
  clearGitHubContext,
} from "../../../../../src/dashboard/lib/github-client";
import { getSecret } from "@kody-ade/base/vault/get-secret";
import { emitSystemEvent } from "@kody-ade/base/events";
import { recordAudit } from "@kody-ade/base/activity/audit";
import { ensureTriggerStateWriter } from "@kody-ade/kody-chat-dashboard/user-state";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import {
  resolveClientBrand,
  type ClientBrand,
} from "../../../../../src/dashboard/lib/client-brand";
import { resolveChatModel } from "../resolve-model";
import { supportsVision } from "@kody-ade/kody-chat-dashboard/core/vision-support";
import { formatAttachmentForTextBackend } from "@kody-ade/kody-chat-dashboard/core/attachment-text";
import {
  buildSystemPrompt,
  formatUserInstructionsPromptSection,
  type CapabilityContext,
  type TaskContext,
  type OrgContext,
} from "./system-prompt";
import {
  loadChatDefaults,
  composeBasePrompt,
  filterToolsByAllowlist,
  buildToolIndex,
  CRITICAL_REMINDERS_MD,
  FOLLOW_UP_QUESTION_CONTRACT,
} from "../../../../../src/dashboard/lib/chat-defaults";
import { createGitHubTools } from "../tools/github-tools";
import { createPipelineTools } from "../tools/pipeline-tools";
import { createMachineTools } from "../tools/machine-tools";
import { isLocalMachineAccessEnabled } from "@kody-ade/terminal/machine-exec";
import { createBugTools } from "../tools/bug-tools";
import { createTaskTools } from "../tools/task-tools";
import { createAgentTools } from "../tools/agent-tools";
import { createMemoryTools } from "../tools/memory-tools";
import { createCapabilityTools } from "../tools/capability-tools";
import { createCrossRepositoryCapabilityTools } from "../tools/cross-repository-capability-tools";
import { createWorkflowTools } from "../tools/workflow-tools";
import { createSelfConfigurationTools } from "../tools/self-configuration-tools";
import { createBlueprintTools } from "../tools/blueprint-tools";
import { createWorkflowApiClient } from "../tools/workflow-api-client";
import { createAgencyApiClient } from "../tools/agency-api-client";
import { assessPreparedAgencyRequest } from "@kody-ade/agency/agency-request-manager";
import type { AgencyRequestState } from "@kody-ade/workspace/todos";
import {
  coerceWorkflowInput,
  validateWorkflowDefinition,
  validateWorkflowInput,
  type WorkflowDefinition,
} from "../../../../../src/dashboard/lib/workflow-definitions";
import {
  createAgencyRequestApproval,
  readAgencyRequestApproval,
  runApprovedAgencyRequestDirectly,
  showAgencyRequestApprovalDirectly,
} from "../tools/agency-request-approval";
import { createAgencyLifecycleTools } from "../tools/agency-lifecycle-tools";
import { createReleaseTools } from "../tools/release-tools";
import { createKodyTools } from "../tools/kody-tools";
import { applyVibeToolPolicy } from "./vibe-tool-policy";
import { fetchUrlTool } from "../tools/fetch-url";
import { featureTools } from "../tools/feature-tools";
import { createUiTools } from "../tools/ui-tools";
import {
  createApprovedToolActionResponse,
  readToolActionApproval,
  runApprovedToolAction,
  stageToolsForApproval,
} from "../tools/tool-action-approval";
import { createGuidedFlowTools } from "../tools/guided-flow-tools";
import { ConvexGuidedFlowReader } from "../../guided-flows/reader";
import { buildGuidedFlowTurnContext } from "../guided-flow-context";
import {
  CHAT_OUTPUT_CONTRACT_DATA_TYPE,
  CHAT_OUTPUT_TOOL_NAMES,
  EXCLUSIVE_TOOL_OUTPUT_MODE,
  FINAL_ANSWER_FOLLOW_UP_ERROR,
  FINAL_ANSWER_TOOL,
  SHOW_VIEW_TOOL,
  isFinalAnswerOutput,
  getToolErrorMessage,
  getToollessRecoveryContent,
  getViewRecoveryContent,
  hasSuccessfulRenderedViewResult,
  hasVisibleChatToolOutput,
  isToolErrorOutput,
  selectChatOutputActiveTools,
  selectChatOutputToolChoice,
  shouldRetryToollessTurn,
  shouldRequireFollowUpQuestion,
} from "../../../../../src/dashboard/lib/chat-output-tools";
import { parseReasoning } from "@kody-ade/kody-chat-dashboard/core/reasoning";
import { getChatProviderCapabilities } from "@kody-ade/kody-chat-dashboard/core/provider-capabilities";
import { getPublicBaseUrl } from "@kody-ade/base/auth/oauth-url";
import {
  CONVERSATION_ONLY_MEMORY_INSTRUCTION,
  hasActiveConversationOnlyMemoryScope,
  hasExplicitMemoryCommand,
} from "../../../../../src/dashboard/lib/memory-command-intent";
import { BUILTIN_VIEW_RENDERER_DEFINITIONS } from "../../../../../src/dashboard/lib/view-renderers/builtin";
import { buildChatViewCatalog } from "../../../../../src/dashboard/lib/view-renderers/spec/catalog";
import { buildViewComponentRules } from "../../../../../src/dashboard/lib/view-renderers/spec/prompt";
import {
  shouldAllowPreRenderToolCallsForTurn,
  shouldRequireStructuredViewForTurn,
  shouldRequireViewOutputForTurn,
} from "../../../../../src/dashboard/lib/view-renderers/chat-intent";
import { createCommandTools } from "../tools/commands-tools";
import { createContextTools } from "../tools/context-tools";
import { createTodoTools } from "../tools/todo-tools";
import { createToolExecutionScope } from "./tool-execution-order";
import { createInstructionsTools } from "../tools/instructions-tools";
import { createPersonalChatTools } from "../tools/personal-tools";
import { createVariableTools } from "../tools/variables-tools";
import { createSecretTools } from "../tools/secrets-tools";
import { createModelTools } from "../tools/models-tools";
import { createWebhookTools } from "../tools/webhooks-tools";
import { createCmsTools } from "../tools/cms-tools";
import { createUserStateTools } from "../tools/user-state-tools";
import { createPositionTools } from "../tools/position-tools";
import { applyReasoning } from "@kody-ade/kody-chat-dashboard/core/reasoning-adapter";
import { containsToolCallMarkup } from "@kody-ade/kody-chat-dashboard/core/tool-call-strip";
import {
  findPermanentToolFailure,
  formatPermanentToolFailure,
  isRecoverableRepositoryReadFailure,
} from "../../../../../src/dashboard/lib/chat/core/permanent-tool-failure";
import { createAgentAdminTools } from "../tools/agent-admin-tools";
import {
  readCapabilityFile,
  readResolvedCapabilityFile,
} from "@kody-ade/agency/capabilities";
import { readBuiltinAgentCapability } from "@kody-ade/agency/builtin-agents";
import { loadRelevantMemoryForPrompt } from "@kody-ade/workspace/memory";
import {
  loadViewRendererContextForPrompt,
  loadViewRendererContextForTenant,
  type ViewRendererDefinition,
} from "../../../../../src/dashboard/lib/view-renderers/standalone-renderer-store";
import { loadInstructionsForPrompt } from "@kody-ade/workspace/instructions/files";
import { loadContextForPrompt } from "@kody-ade/workspace/context/files";
import { loadGuidanceForPrompt } from "@kody-ade/workspace/guidance/files";
import { ensureKodyRuntimeInitialized } from "./runtime-init";
import {
  isValidSlug as isValidAgentSlug,
  listResolvedAgentFiles,
} from "../../../../../src/dashboard/lib/agent-files";
import {
  appendAgentChatSpeakerOverride,
  buildAgentChatIdentity,
} from "../../../../../src/dashboard/lib/agent-chat-identity";
import {
  buildAgentHandoffPrompt,
  buildPreviousAgentContextPrompt,
  resolveAgentHandoffForPrompt,
} from "../../../../../src/dashboard/lib/chat/core/agent-handoff";
import type { AgentHandoff } from "../../../../../src/dashboard/lib/chat-types";
import {
  buildExplicitViewRequestInstruction,
  parseExplicitViewRequest,
} from "./view-request";
import { startDurableTurn, type DurableTurn } from "../durable-turn";
import type { ProjectAssessmentSynthesisRecovery } from "../durable-turn";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { createDurableTurnProgressRecorder } from "../durable-turn-progress";
import {
  isCompleteProjectAssessmentRequest,
  isBlueprintCreationIntakeRequest,
  isAgencyRequestIntakeRequest,
  getAgencyRequestAssessmentTodoSlug,
  isClearlyConversationalTurn,
  isParentOwnedArchitectureAdvice,
} from "./public-agent-routing";
import {
  CREATE_BLUEPRINT_FLOW_ID,
  NEW_AGENCY_REQUEST_FLOW_ID,
  PROJECT_ASSESSMENT_FLOW_ID,
} from "../../../../../src/dashboard/lib/guided-flows/builtins";
import { CREATE_BLUEPRINT_MODEL_GUIDE } from "../../../../../src/dashboard/lib/request-blueprints/create-blueprint";
import {
  publishProjectAssessmentReport,
  PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX,
  runConfiguredPublicAgentAssignments,
  retryProjectAssessmentSynthesis,
} from "./public-agent-chat-runtime";
import { PUBLIC_AGENT_DEFAULT_MAX_STEPS } from "./public-agent-limits";
import { createPublicAgentEvidenceTool } from "./public-agent-evidence-tool";
import {
  isolateUserBrowserTurnTools,
  isUserBrowserCapabilityReadResult,
  isUserBrowserWorkRequest,
  selectUserBrowserActiveTools,
} from "./browser-work-routing";
import { readPreviewCapabilityContinuation } from "../../../../../src/dashboard/lib/picker/protocol";

export const runtime = "nodejs";
// Research turns can chain up to ~10 tool rounds (search → read → blame → …)
// each with its own LLM round-trip. 60s would cut us off mid-stream and the
// UI would hang. 300s is the Vercel Pro ceiling and gives plenty of slack.
export const maxDuration = 300;

// Provider/model are managed entirely from the dashboard. The
// `LLM_MODELS` variable lists user-curated models; each entry binds a
// model to its own `apiKeySecret`, `baseURL`, and wire `protocol`.
// At request time we read the matching secret from the vault and pick
// the SDK based on protocol — `anthropic` for Claude's native Messages
// API (prompt caching + thinking control), `openai` for OpenAI-compat
// endpoints (covers most OpenAI-compatible providers — Groq, OpenRouter,
// Mistral, DeepSeek, xAI, self-hosted LiteLLM, etc).
//
// If no model resolves or the key is missing, the route returns 409
// with `fallback: "kody-live"` so the client routes the same turn
// through the GitHub Actions engine.

interface IncomingTextPart {
  type: "text";
  text: string;
}
interface IncomingImagePart {
  type: "image";
  /** base64 data URL (data:<mime>;base64,<...>) or raw http(s) URL */
  image: string;
  mimeType?: string;
}
interface IncomingFilePart {
  type: "file";
  data: string;
  mediaType: string;
  filename?: string;
}
type IncomingPart = IncomingTextPart | IncomingImagePart | IncomingFilePart;

interface IncomingMessage {
  role: "user" | "assistant" | "system";
  content: string | IncomingPart[];
}

function isPartsArray(c: unknown): c is IncomingPart[] {
  return (
    Array.isArray(c) &&
    c.every((p) => p && typeof p === "object" && "type" in p)
  );
}

/**
 * The Vercel AI SDK accepts an `image` part as either a URL or raw
 * base64-encoded bytes. If we pass a `data:` URL string, it tries to
 * resolve it as a URL and rejects the `data:` scheme. Strip the
 * `data:<mime>;base64,` prefix and recover the mime type from it.
 */
function parseImageData(
  image: string,
  fallbackMime?: string,
): { data: string; mediaType?: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(image);
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime };
  return { data: image, mediaType: fallbackMime };
}

function parseFileData(
  data: string,
  fallbackMime: string,
): { data: string; mediaType: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(data);
  if (m) return { data: m[2], mediaType: m[1] || fallbackMime };
  return { data, mediaType: fallbackMime };
}

// Cap on the number of prior turns we resend to the model. Long histories
// inflate the first round-trip dramatically (especially with thinking
// enabled and 20+ tool schemas), and older messages rarely change the
// next answer. The user-visible chat keeps its full transcript — only
// the request to the model is trimmed.
const MAX_HISTORY_MESSAGES = 50;

/**
 * Default cap on tool-calling rounds per turn. Optimized for deep analysis:
 * the model can run a real research loop (search → read → blame → commits
 * → re-search → …) without the prompt's "no fixed budget" rule getting cut
 * off by the code. The `maxDuration: 300` Vercel ceiling still bounds
 * wall-clock time, and a long turn that runs out of wall-clock is a
 * better failure mode than a mid-investigation cut-off.
 *
 * Per-model override: `maxSteps` on the LLM_MODELS entry wins over this
 * default, so a model that runs longer research chains (e.g. reasoning
 * models that branch more) can be lifted individually without raising the
 * cap for every other model. Pass `null` to disable the cap for a model
 * (rely on `maxDuration` alone).
 */
export const DEFAULT_MAX_STEPS = 100;

function successfulToolResult(toolName: string): StopCondition<ToolSet> {
  return ({ steps }) =>
    steps[steps.length - 1]?.toolResults?.some(
      (result) =>
        result.toolName === toolName && !isToolErrorOutput(result.output),
    ) ?? false;
}

/**
 * Stop once ANY tool result already IS a rendered-view directive —
 * matched by shape, not tool name, so guided_flow_start (and any future
 * card-producing tool) ends the turn exactly like show_view does. The
 * directive streams to the client as the visible output; letting the
 * model keep going only makes it re-render the same card via show_view
 * as a chat-target echo WITHOUT the guided-flow submit wiring, which
 * then clobbers the working card in the UI.
 */
function successfulRenderedViewResult(): StopCondition<ToolSet> {
  return ({ steps }) => hasSuccessfulRenderedViewResult(steps);
}

function permanentToolFailureResult(): StopCondition<ToolSet> {
  return ({ steps }) => findPermanentToolFailure(steps) !== null;
}

/**
 * Cap on `show_view` attempts per turn. A failed call returns its
 * validation error as the tool result so the model can fix the spec and
 * retry; the cap stops a model that keeps producing invalid specs.
 */
export const MAX_SHOW_VIEW_ATTEMPTS = 3;

/** Bound evidence gathering before an Agency request must record a decision. */
export const MAX_AGENCY_ASSESSMENT_READ_RESULTS = 8;

/**
 * Cap on corrective re-runs after a turn ends with no visible output at
 * all (no output tool, no answer text). See the silent-turn retry block.
 */
export const MAX_SILENT_TURN_RETRIES = 2;

/**
 * Stop once the tool succeeds, or once it has been attempted `maxAttempts`
 * times (successful or not) — whichever comes first.
 */
function settledToolAttempts(
  toolName: string,
  maxAttempts: number,
): StopCondition<ToolSet> {
  return ({ steps }) => {
    const lastStep = steps[steps.length - 1];
    const succeeded =
      lastStep?.toolResults?.some(
        (result) =>
          result.toolName === toolName && !isToolErrorOutput(result.output),
      ) ?? false;
    if (succeeded) return true;
    const attempts = steps.reduce(
      (count, step) =>
        count +
        (step.toolCalls?.filter((call) => call.toolName === toolName).length ??
          0),
      0,
    );
    return attempts >= maxAttempts;
  };
}

// Stream tracing uses console.* (not the pino `logger`) on purpose: pino
// buffers writes asynchronously, and Vercel functions can be killed or
// suspended mid-stream — losing the trail. console.* is line-flushed on
// Vercel's runtime so we always see the events that fired before death.
function traceLog(data: object, msg: string): void {
  console.log(JSON.stringify({ level: "info", msg, ...data }));
}
function traceWarn(data: object, msg: string): void {
  console.warn(JSON.stringify({ level: "warn", msg, ...data }));
}
function traceError(data: object, msg: string): void {
  console.error(JSON.stringify({ level: "error", msg, ...data }));
}

/**
 * Pull the provider's response body out of an AI SDK error. The SDK wraps
 * HTTP errors as `APICallError` with a `responseBody` (raw text) and a
 * `data` field (parsed JSON when available). Without this, a provider 400
 * surfaces as a useless "Bad Request" — with it, the user sees the
 * specific validation message ("tools[7].function.parameters: ...").
 */
interface ProviderErrorLike {
  message?: string;
  name?: string;
  statusCode?: number;
  responseBody?: string;
  url?: string;
  data?: unknown;
  cause?: unknown;
}

function asProviderErrorLike(e: unknown): ProviderErrorLike | null {
  if (!e || typeof e !== "object") return null;
  return e as ProviderErrorLike;
}

function formatProviderError(error: unknown): string {
  const e = asProviderErrorLike(error);
  if (!e) return String(error);
  // Prefer a parsed Google/OpenAI-style { error: { message } } payload.
  const data = e.data as { error?: { message?: string } } | undefined;
  if (data && typeof data === "object") {
    const inner = data.error?.message;
    if (typeof inner === "string" && inner.length > 0) {
      return e.statusCode ? `[${e.statusCode}] ${inner}` : inner;
    }
  }
  // Fall back to the raw response body — clipped so a giant HTML page
  // doesn't poison the UI bubble.
  if (typeof e.responseBody === "string" && e.responseBody.length > 0) {
    const clipped =
      e.responseBody.length > 600
        ? `${e.responseBody.slice(0, 600)}…`
        : e.responseBody;
    return e.statusCode ? `[${e.statusCode}] ${clipped}` : clipped;
  }
  if (typeof e.message === "string" && e.message.length > 0) return e.message;
  return String(error);
}

function extractProviderErrorMeta(error: unknown): Record<string, unknown> {
  const e = asProviderErrorLike(error);
  if (!e) return {};
  const meta: Record<string, unknown> = {};
  if (typeof e.name === "string") meta.errName = e.name;
  if (typeof e.statusCode === "number") meta.statusCode = e.statusCode;
  if (typeof e.url === "string") meta.url = e.url;
  if (typeof e.responseBody === "string") {
    meta.responseBody =
      e.responseBody.length > 1200
        ? `${e.responseBody.slice(0, 1200)}…`
        : e.responseBody;
  }
  return meta;
}

function trimToRecent(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  // Some models reject histories that don't start with a user message. Skip
  // any leading assistant/system messages in the trimmed slice.
  const firstUserIdx = trimmed.findIndex((m) => m.role === "user");
  return firstUserIdx <= 0 ? trimmed : trimmed.slice(firstUserIdx);
}

/**
 * Collapse multimodal user turns into plain text for a text-only model.
 * A model with no vision (e.g. MiniMax) either rejects an image part or
 * silently drops it. Keep small attachments inline, but omit oversized raw
 * data so screenshots do not explode the provider context window. Vision
 * models skip this and keep real image parts. Assistant/system turns are
 * already strings.
 */
function inlineImagePartsForTextModel(
  messages: ModelMessage[],
): ModelMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string" || !Array.isArray(m.content)) return m;
    const text = m.content
      .map((p) => {
        if (p.type === "text") return p.text;
        if (p.type === "image") {
          const img = typeof p.image === "string" ? p.image : "";
          return img
            ? formatAttachmentForTextBackend({
                kind: "image",
                data: img,
                mimeType: p.mediaType,
              })
            : "";
        }
        if (p.type === "file") {
          const data = typeof p.data === "string" ? p.data : "";
          return data
            ? formatAttachmentForTextBackend({
                kind: "file",
                data,
                mimeType: p.mediaType,
                name: p.filename,
              })
            : "";
        }
        return "";
      })
      .filter((t) => t !== "")
      .join("\n\n");
    return { ...m, content: text } as ModelMessage;
  });
}

function messagesHaveImageParts(messages: ModelMessage[]): boolean {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((part) => part.type === "image"),
  );
}

function normalizeMessages(raw: IncomingMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of raw) {
    if (
      !m ||
      (m.role !== "user" && m.role !== "assistant" && m.role !== "system")
    )
      continue;

    if (typeof m.content === "string") {
      if (m.content.trim() === "") continue;
      out.push({ role: m.role, content: m.content } as ModelMessage);
      continue;
    }

    if (!isPartsArray(m.content)) continue;

    // Multimodal parts are only valid on a user message in the SDK shape.
    // Strip empty text parts; drop the message if nothing remains.
    const parts = m.content
      .map((p) => {
        if (p.type === "text") {
          return p.text.trim() === ""
            ? null
            : { type: "text" as const, text: p.text };
        }
        if (p.type === "image") {
          const parsed = parseImageData(p.image, p.mimeType);
          return {
            type: "image" as const,
            image: parsed.data,
            ...(parsed.mediaType ? { mediaType: parsed.mediaType } : {}),
          };
        }
        if (p.type === "file") {
          const parsed = parseFileData(p.data, p.mediaType);
          return {
            type: "file" as const,
            data: parsed.data,
            mediaType: parsed.mediaType,
            ...(p.filename ? { filename: p.filename } : {}),
          };
        }
        return null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (parts.length === 0) continue;
    if (m.role === "user") {
      out.push({ role: "user", content: parts });
    } else {
      // assistant/system can't carry image parts — collapse to text only.
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text.trim() === "") continue;
      out.push({ role: m.role, content: text } as ModelMessage);
    }
  }
  return out;
}

function getLatestUserText(messages: ModelMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) continue;
    const text = message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (text.length > 0) return text;
  }
  return null;
}

function requestWithAuth(req: NextRequest, auth: RequestAuth): NextRequest {
  const headers = new Headers(req.headers);
  for (const [key, value] of Object.entries(buildKodyAuthHeaders(auth))) {
    headers.set(key, value);
  }
  return new NextRequest(req.url, {
    method: req.method,
    headers,
  });
}

export async function POST(req: NextRequest) {
  // Short trace ID lets us follow a single chat request through every log
  // line (start, per-tool start/finish, per-step finish, errors, finish).
  // Grep `vercel logs` for the ID to see one session's full trace.
  const traceId = randomBytes(4).toString("hex");
  const reqStartedAt = Date.now();

  try {
    return await handleKodyDirectPost(req, traceId, reqStartedAt);
  } catch (err) {
    clearGitHubContext();
    traceError(
      {
        traceId,
        err: formatProviderError(err),
        ...extractProviderErrorMeta(err),
      },
      "kody-direct: request setup failed",
    );
    return NextResponse.json(
      { error: "Chat setup failed", traceId },
      { status: 500 },
    );
  }
}

async function handleKodyDirectPost(
  req: NextRequest,
  traceId: string,
  reqStartedAt: number,
) {
  // Surface scoping (phase 2 step 6). Admin PAT headers → full scope,
  // byte-identical to before. A valid surface ticket without a PAT →
  // restricted client scope (agent forced, tools filtered below). Neither →
  // today's 401 via requireKodyAuth, unchanged.
  const surfaceScope = resolveSurfaceScope(req.headers);
  const requestContextProvider = getChatRequestContextProvider();
  const hostUser =
    surfaceScope.kind !== "client"
      ? ((await requestContextProvider?.resolveUser(req)) ?? null)
      : null;
  if (surfaceScope.kind !== "client" && !hostUser) {
    const authError = await requireUserAuth(req);
    if (authError) return authError;
  }
  await ensureKodyRuntimeInitialized();
  const clientSurface = surfaceScope.kind === "client";
  let storedRepositoryCredentials: readonly KodyRepositoryCredential[] = [];
  if (hostUser && requestContextProvider?.resolveRepositories) {
    try {
      storedRepositoryCredentials =
        await requestContextProvider.resolveRepositories(req);
    } catch {
      storedRepositoryCredentials = [];
    }
  }

  // Key resolution is per-model: each LLM_MODELS entry names which secret
  // to read at request time. We defer the actual lookup until after we
  // resolve the model below, so a missing key on model X never blocks
  // model Y.

  let body: {
    messages?: IncomingMessage[];
    /** Derived memory from older visible messages after automatic compaction. */
    conversationSummary?: string;
    model?: string;
    task?: TaskContext;
    /** GitHub login of the requester — gates remote_* tools. Optional. */
    actorLogin?: string;
    /** Current capability context — scopes the chat to a specific capability folder. */
    capability?: CapabilityContext;
    /** Currently-viewed report on /reports — scopes the chat to advise on it. */
    report?: { slug: string; title: string; body: string; path?: string };
    /** Safe metadata for the App selected on the Apps page. */
    app?: import("@kody-ade/base/kody-system-prompt").AppContext;
    /** Org workspace scope from /org/:org. */
    org?: OrgContext;
    /**
     * The dashboard page the user is currently viewing, as a noun phrase
     * (e.g. "the Variables page (/variables)"). Surfaced as a `## Current
     * page` system section so "what am I looking at?" resolves.
     */
    currentPage?: string;
    /**
     * Preview/page evidence collected by the dashboard for this turn. Task
     * creation tools append it to issue bodies so the runner sees the same
     * view example the chat saw.
     */
    previewContext?: string;
    /**
     * Which agentIdentity to use for the system prompt. Defaults to `kody`.
     * Any agent whose backend is `kody-direct` is served natively here;
     * agents whose backend is the engine, brain, or kody-live don't have
     * their prompts proxied through this route, so the route falls back to
     * `AGENT_KODY`'s prompt for those (the dashboard reaches this route in
     * voice mode regardless of selected agent — voice is a modality, not a
     * backend swap).
     */
    agentId?: AgentId;
    /**
     * Repo/store agent identity slug addressed with `@slug` in chat. This is
     * a prompt identity swap for this in-process turn, not a runner dispatch.
     */
    agentSlug?: string;
    /** Latest persisted agent switch for this conversation. */
    agentHandoff?: AgentHandoff;
    /** Prior agent epoch, relabeled as background rather than assistant history. */
    agentHandoffContext?: string;
    /**
     * Voice modality. When true the server appends `VOICE_OVERLAY_PROMPT`
     * to the resolved agent's base prompt (no markdown, short sentences,
     * symbols read aloud as words), disables thinking/reasoning streaming,
     * and prefers a model flagged `speech: true` in `LLM_MODELS` when the
     * client hasn't pinned a model explicitly. The chosen agent's brain
     * and tools stay in charge — only the output shape changes.
     */
    voiceMode?: boolean;
    /**
    /**
     * Vibe mode. True when chat is scoped to the Vibe workspace. Kody chat
     * may research, plan, and create issues, but implementation-start tools
     * are stripped so it cannot open PRs, start runners, or dispatch @kody.
     */
    vibeMode?: boolean;
    /**
     * User-picked thinking level for the resolved model. Validated against
     * the model's declared `reasoning.efforts` — unknown values fall back
     * to `reasoning.default`. Translated to the provider's wire shape
     * (anthropic_budget, openai_effort, …) by `applyReasoning()` before
     * being merged into `streamText` options. Omitted when the model has
     * no reasoning config — `applyReasoning` then returns `{}`.
     */
    reasoningEffort?: string;
    conversationId?: string;
    turnId?: string;
    retryAssessmentTurnId?: string;
    conversationAgent?: { slug: string; title: string };
    machineAccess?: "none" | "local" | "brain";
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof body.conversationSummary === "string" &&
    body.conversationSummary.length > 20_000
  ) {
    return NextResponse.json(
      { error: "conversationSummary too large" },
      { status: 400 },
    );
  }
  if (
    typeof body.agentHandoffContext === "string" &&
    body.agentHandoffContext.length > 8_000
  ) {
    return NextResponse.json(
      { error: "agentHandoffContext too large" },
      { status: 400 },
    );
  }

  let repoScopedReq = req;
  let surfaceBrand: ClientBrand | null = null;
  if (surfaceScope.kind === "client") {
    const background = await resolveBackgroundToken(
      surfaceScope.owner,
      surfaceScope.repo,
    );
    if (!background) {
      return NextResponse.json(
        {
          error: "client_surface_not_configured",
          message:
            "This client chat surface is not configured with a repo token.",
        },
        { status: 401 },
      );
    }
    const auth: RequestAuth = {
      token: background.token,
      owner: surfaceScope.owner,
      repo: surfaceScope.repo,
    };
    repoScopedReq = requestWithAuth(req, auth);
    surfaceBrand = await resolveClientBrand(surfaceScope.brandSlug, auth);
    if (!surfaceBrand) {
      return NextResponse.json({ error: "brand_not_found" }, { status: 404 });
    }
  }

  const allMessages = normalizeMessages(body.messages ?? []);
  if (allMessages.length === 0) {
    return NextResponse.json(
      { error: "messages required (non-empty)" },
      { status: 400 },
    );
  }
  const messages = body.conversationSummary
    ? allMessages
    : trimToRecent(allMessages);
  const latestUserText = getLatestUserText(messages);
  const explicitMemoryCommand = hasExplicitMemoryCommand(latestUserText);
  const conversationOnlyMemoryRequest = hasActiveConversationOnlyMemoryScope(
    messages.map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : "",
    })),
  );
  const explicitViewRequest = parseExplicitViewRequest(latestUserText);
  const agencyAssessmentTodoSlug = getAgencyRequestAssessmentTodoSlug(
    latestUserText ?? "",
  );
  const agencyAssessmentHandoffRequested = agencyAssessmentTodoSlug !== null;
  const agencyRequestApproval = readAgencyRequestApproval(latestUserText);
  const trimmedCount = allMessages.length - messages.length;
  const hasImageParts = messagesHaveImageParts(messages);

  // Resolve the model from the configured + built-in catalog in Convex variables.json.
  // The client can override per-request via `body.model`, but it must
  // match an enabled entry — we never trust arbitrary ids from the wire.
  // Voice mode does not affect model selection; it's a per-turn prompt
  // overlay only (see system-prompt builder).
  const voiceMode = body.voiceMode === true;
  // Model resolution (list → pick → key → SDK) is shared with the title
  // route via resolveChatModel so the two can't drift. Voice mode does
  // not affect model selection; it's a per-turn prompt overlay only.
  const modelOverride = clientSurface ? surfaceBrand?.modelId : body.model;
  const pendingAutomaticFallbacks: Array<{ from: string; to: string }> = [];
  let publishAutomaticFallback = (event: { from: string; to: string }) => {
    pendingAutomaticFallbacks.push(event);
  };
  const resolution = await resolveChatModel(repoScopedReq, modelOverride, {
    preferVision: hasImageParts,
    onAutomaticFallback: (event) => publishAutomaticFallback(event),
    onModelCall: (event) => {
      const { error, ...details } = event;
      if (event.phase === "failed") {
        traceError(
          {
            traceId,
            ...details,
            err: formatProviderError(error),
            ...extractProviderErrorMeta(error),
          },
          "kody-direct: model call failed",
        );
        return;
      }
      traceLog({ traceId, ...details }, "kody-direct: model call");
    },
  });
  if ("error" in resolution) return resolution.error;
  const { model, resolvedModel } = resolution;
  const providerCapabilities = getChatProviderCapabilities(resolvedModel);
  const modelId = resolvedModel.id;
  // Client-surface turns carry no PAT, so there is no GitHub identity to
  // verify — actor-gated tools (remote_*) simply stay off (null login).
  let verifiedActorLogin: string | null = null;
  let verifiedActorGithubId: number | null = null;
  let verifiedUserId: string | null = hostUser?.id ?? null;
  const repo = getRequestAuth(repoScopedReq);
  let connectedRepositories: Array<{ owner: string; repo: string }> = repo
    ? [{ owner: repo.owner, repo: repo.repo }]
    : [];
  if (!clientSurface) {
    if (repo) {
      const actorResult = await verifyOperatorActor(repoScopedReq);
      if (actorResult instanceof NextResponse) return actorResult;
      verifiedActorLogin = actorResult.identity.login;
      verifiedActorGithubId = actorResult.identity.githubId;
      verifiedUserId ??= `github:${actorResult.identity.githubId}`;
    } else if (!hostUser) {
      const actorResult = await verifyOperatorActor(
        repoScopedReq,
        body.actorLogin,
      );
      if (actorResult instanceof NextResponse) return actorResult;
      verifiedActorLogin = actorResult.identity.login;
      verifiedActorGithubId = actorResult.identity.githubId;
      verifiedUserId ??= `github:${actorResult.identity.githubId}`;
    } else {
      verifiedActorLogin = hostUser.label;
    }
  }
  // Only vision-capable models get real image parts. For text-only models
  // (looked up from LiteLLM's supports_vision data) inline the image as text
  // so the attachment still rides along instead of being dropped/rejected.
  const modelIsVision =
    supportsVision(resolvedModel.id) || supportsVision(resolvedModel.modelName);
  let modelMessages = modelIsVision
    ? messages
    : inlineImagePartsForTextModel(messages);
  const turnSystemInstructions: string[] = [];
  if (conversationOnlyMemoryRequest) {
    turnSystemInstructions.push(CONVERSATION_ONLY_MEMORY_INSTRUCTION);
  }
  if (agencyAssessmentHandoffRequested) {
    turnSystemInstructions.push(
      "This is the Agency Request Manager's assessment handoff. Kody owns this lifecycle step. Read the Todo, verify feasibility and the Workflow input schema with tools, then save the concrete plan, exact execution.workflowId, validated execution.input, and waiting-approval phase. If execution.activations installs that Workflow, its absence from list_workflows is expected: call read_workflow with the exact execution.workflowId because it can read Store candidates before activation, and do not mark the request blocked merely because it is not active yet. Preserve a saved Strategy Blueprint Workflow and activation path. For default-branch CI requests, use kody_get_default_branch_ci as the authoritative CI target; never select a repair target from the raw Actions list because Kody orchestration runs are not repository CI. The server presents the approval action after the save. Do not call show_view and do not delegate ownership of this step.",
    );
  }
  if (agencyRequestApproval?.action === "approve") {
    turnSystemInstructions.push(
      `The user approved Agency request Todo ${JSON.stringify(agencyRequestApproval.todoSlug)}. Call run_agency_request exactly once for that Todo, then report the returned Run id and monitoring state. Do not rediscover or change the approved plan.`,
    );
  }
  if (isParentOwnedArchitectureAdvice(latestUserText ?? "")) {
    turnSystemInstructions.push(
      `This is an architecture recommendation, not a request to create anything and not a question about configured chat models. Give a direct verdict instead of an inventory or clarification question. Treat the existing Kody Chat path as the current owner and recommend extending it unless verified repository evidence proves a requirement it cannot satisfy. Explain the ownership tradeoff briefly. ${FOLLOW_UP_QUESTION_CONTRACT}`,
    );
  }
  const durableIdentity =
    verifiedUserId !== null &&
    typeof body.conversationId === "string" &&
    body.conversationId.trim() &&
    typeof body.turnId === "string" &&
    body.turnId.trim() &&
    body.conversationAgent &&
    typeof body.conversationAgent.slug === "string" &&
    typeof body.conversationAgent.title === "string"
      ? {
          tenantId: `user:${verifiedUserId}`,
          conversationId: body.conversationId.trim(),
          turnId: body.turnId.trim(),
          backend: "direct" as const,
          agent: {
            slug: body.conversationAgent.slug.trim(),
            title: body.conversationAgent.title.trim(),
          },
          createIfMissing: {
            ...(repo ? { owner: repo.owner, repo: repo.repo } : {}),
            modelId,
            createdBy: verifiedActorLogin
              ? `operator:${verifiedActorLogin.toLowerCase()}`
              : "server",
          },
        }
      : null;
  if (
    verifiedUserId &&
    typeof body.conversationId === "string" &&
    body.conversationId.trim()
  ) {
    try {
      const personalGuidedFlowContext = await buildGuidedFlowTurnContext(
        new ConvexGuidedFlowReader({
          tenantId: `user:${verifiedUserId}`,
          actorId: verifiedUserId,
          conversationId: body.conversationId.trim(),
        }),
      );
      if (personalGuidedFlowContext)
        turnSystemInstructions.push(personalGuidedFlowContext);
      if (repo && verifiedActorLogin) {
        const repositoryGuidedFlowContext = await buildGuidedFlowTurnContext(
          new ConvexGuidedFlowReader({
            tenantId: `${repo.owner}/${repo.repo}`,
            actorId: verifiedActorLogin,
            conversationId: body.conversationId.trim(),
          }),
        );
        if (repositoryGuidedFlowContext)
          turnSystemInstructions.push(repositoryGuidedFlowContext);
      }
    } catch (error) {
      traceWarn(
        { err: error, conversationId: body.conversationId },
        "guided-flow context unavailable",
      );
    }
  }
  ensureTriggerStateWriter();
  const eventUserId = verifiedActorLogin
    ? `operator:${verifiedActorLogin.toLowerCase()}`
    : null;
  emitSystemEvent(
    "chat.message.sent",
    { transport: "direct" },
    {
      userId: eventUserId,
      brand: repo ? { owner: repo.owner, repo: repo.repo } : null,
      source: "server",
      octokit: repo ? createUserOctokit(repo.token) : null,
    },
  );

  // Memory index injection requires the github-client module-level context
  // (the cached loader uses `getOctokit()` / `getOwner()` / `getRepo()`).
  // Set the context here, before buildSystemPrompt, and rely on the
  // existing onFinish / catch paths to clear it. Per-request octokits
  // for GitHub tools are still created separately below to avoid races.
  const guidanceAgentSlug =
    !clientSurface &&
    typeof body.agentSlug === "string" &&
    body.agentSlug.trim()
      ? body.agentSlug.trim()
      : "kody";
  let memoryContext: string | null = null;
  let userInstructions: string | null = null;
  let context: string | null = null;
  let constraints: string | null = null;
  let policies: string | null = null;
  let featureGuidePromptSection: string | null = null;
  let viewRendererRules: string | null = null;
  let viewRendererDefinitions: ViewRendererDefinition[] = [];
  if (verifiedUserId && !clientSurface) {
    const personalTenantId = `user:${verifiedUserId}`;
    if (!repo && !conversationOnlyMemoryRequest) {
      try {
        memoryContext = await loadRelevantMemoryForPrompt(
          {
            actor: { kind: "user", id: verifiedUserId },
            tenantId: personalTenantId,
            includeRepositoryScope: false,
          },
          latestUserText ?? "",
        );
      } catch (err) {
        traceWarn({ traceId, err }, "personal memory unavailable");
      }
    }
    try {
      const row = (await createBackendClient().query(backendApi.repoDocs.get, {
        tenantId: personalTenantId,
        kind: "instructions",
      })) as { doc?: { body?: string } } | null;
      userInstructions = row?.doc?.body?.trim() || null;
    } catch (err) {
      traceWarn({ traceId, err }, "personal instructions unavailable");
    }
    try {
      const rendererContext =
        await loadViewRendererContextForTenant(personalTenantId);
      viewRendererRules = rendererContext.rules;
      viewRendererDefinitions = rendererContext.definitions;
    } catch (err) {
      traceWarn({ traceId, err }, "personal renderers unavailable");
    }
  }
  if (repo && clientSurface) {
    // Client-surface turns still need the module github context for
    // repo-scoped reads (e.g. the brand's agent file) — but skip the
    // admin-only prompt extras (memory/instructions/context) below.
    setGitHubContext(
      repo.owner,
      repo.repo,
      repo.token,
      repo.storeRepoUrl,
      repo.storeRef,
    );
    // Client chats render with the packaged built-in renderers (the tool
    // catalog already falls back to them). The gating that forces a card
    // for interactive turns must see the same definitions — with an empty
    // list, brand chats never pinned show_view and interactive turns
    // could end with prose or nothing.
    viewRendererDefinitions = [...BUILTIN_VIEW_RENDERER_DEFINITIONS];
    viewRendererRules = buildViewComponentRules(
      buildChatViewCatalog(viewRendererDefinitions),
    );
  }
  if (repo && !clientSurface) {
    setGitHubContext(
      repo.owner,
      repo.repo,
      repo.token,
      repo.storeRepoUrl,
      repo.storeRef,
    );
    if (!conversationOnlyMemoryRequest) {
      try {
        const repositoryMemory = await loadRelevantMemoryForPrompt(
          {
            actor: { kind: "user", id: verifiedUserId! },
            tenantId: `${repo.owner}/${repo.repo}`,
          },
          latestUserText ?? "",
        );
        memoryContext = repositoryMemory;
      } catch (err) {
        // Memory is best-effort; never block the chat. Log and continue.
        traceWarn(
          { traceId, err: err instanceof Error ? err.message : String(err) },
          "kody-direct: memory index load failed (continuing without it)",
        );
      }
    }
    try {
      const repositoryInstructions = await loadInstructionsForPrompt();
      userInstructions =
        [
          userInstructions
            ? `## Personal instructions\n${userInstructions}`
            : null,
          repositoryInstructions
            ? `## Repository instructions\n${repositoryInstructions}`
            : null,
        ]
          .filter(Boolean)
          .join("\n\n") || null;
    } catch (err) {
      // Instructions are best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: user instructions load failed (continuing without them)",
      );
    }
    try {
      context = await loadContextForPrompt();
    } catch (err) {
      // Context is best-effort; never block the chat. Log and continue.
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: context load failed (continuing without it)",
      );
    }
    try {
      const featureGuide = await getFeatureGuideRegistry().resolveForTurn({
        currentPage:
          typeof body.currentPage === "string" ? body.currentPage : null,
        userText: latestUserText ?? "",
      });
      featureGuidePromptSection = featureGuide
        ? formatFeatureGuidePromptSection(featureGuide)
        : null;
    } catch (err) {
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: feature guide load failed (continuing without it)",
      );
    }
    try {
      [constraints, policies] = await Promise.all([
        loadGuidanceForPrompt("constraint", guidanceAgentSlug),
        loadGuidanceForPrompt("policy", guidanceAgentSlug),
      ]);
    } catch (err) {
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: agent guidance load failed (continuing without it)",
      );
    }
    try {
      const viewRendererContext = await loadViewRendererContextForPrompt({
        owner: repo.owner,
        repo: repo.repo,
      });
      const mergedDefinitions = new Map(
        viewRendererDefinitions.map((definition) => [
          definition.slug,
          definition,
        ]),
      );
      for (const definition of viewRendererContext.definitions) {
        mergedDefinitions.set(definition.slug, definition);
      }
      viewRendererDefinitions = [...mergedDefinitions.values()].sort((a, b) =>
        a.slug.localeCompare(b.slug),
      );
      viewRendererRules = buildViewComponentRules(
        buildChatViewCatalog(viewRendererDefinitions),
      );
    } catch (err) {
      traceWarn(
        { traceId, err: err instanceof Error ? err.message : String(err) },
        "kody-direct: view renderer rules load failed (continuing without them)",
      );
    }
  }
  // Pick the agentIdentity. Agents whose backend is `kody-direct` are
  // served natively here; the rest (engine, brain, kody-live) don't have
  // a usable in-process prompt to swap in.
  //
  // For text turns we fall back to AGENT_KODY for non-direct agents so
  // older clients keep working (the dashboard UI never routes a brain or
  // engine TEXT turn here, but defense-in-depth).
  //
  // For VOICE turns we refuse the request instead of silently falling
  // back. Voice was the source of an actual user-visible bug: the
  // dropdown said "brain-fly" while the mic produced an in-process
  // chat answer. The mic is also gated client-side now (see KodyChat
  // VoiceButton), so a voice turn with a non-direct agent is either a
  // stale client or someone calling the API directly — neither should
  // be answered as Kody.
  // Client-surface scope forces the brand's default in-process agent —
  // an external user must not be able to pick an arbitrary agent id.
  const requestedAgentId =
    !clientSurface && body.agentId && isValidAgentId(body.agentId)
      ? body.agentId
      : "kody";
  const requestedAgent: AgentConfig = getAgent(requestedAgentId);
  if (voiceMode && requestedAgent.backend !== "kody-direct") {
    return NextResponse.json(
      {
        error: "voice_not_supported_for_agent",
        message: `Voice mode requires a kody-direct agent. "${requestedAgent.name}" runs on ${requestedAgent.backend}; the voice overlay can't be applied there. Switch to a Kody (in-process) agent in the dropdown to use the mic.`,
      },
      { status: 400 },
    );
  }

  const vibeMode = body.vibeMode === true;
  const requestedMachineAccess =
    body.machineAccess === "local" || body.machineAccess === "brain"
      ? body.machineAccess
      : "none";
  const localMachineAccessEnabled = isLocalMachineAccessEnabled();
  if (requestedMachineAccess === "local" && !localMachineAccessEnabled) {
    return NextResponse.json(
      {
        error: "local_machine_access_unavailable",
        message: "Local machine access is not enabled on this Kody host.",
      },
      { status: 409 },
    );
  }

  // In vibe mode the agent decides Fly vs. Live without asking. Probe
  // the vault for FLY_API_TOKEN so the prompt can tell the agent which
  // runner is actually configured for THIS user — Fly is opt-in, not
  // default. Outside vibe mode this signal isn't used, so skip the
  // vault read on the hot path.
  let flyConfigured = false;
  if (vibeMode) {
    try {
      const flyToken = await getSecret("FLY_API_TOKEN", { req });
      flyConfigured = Boolean(flyToken && flyToken.trim().length > 0);
    } catch {
      flyConfigured = false;
    }
  }

  // Load the chat defaults bundle — agentIdentity + chat capability + workflows + skills.
  // The bundle is the source of truth for the chat's prompt base + tool
  // allowlist. Repo-stored with a TS fallback; step 1 returns TS defaults.
  const chatBundle = await loadChatDefaults(repo?.owner, repo?.repo);
  // Agent identity swaps (@slug) are admin-only from the request body.
  // Client-surface turns can only use the agent configured on the resolved
  // brand, which is loaded server-side from the ticket's repo scope.
  const requestedAgentSlug = clientSurface
    ? (surfaceBrand?.agentSlug ?? "")
    : typeof body.agentSlug === "string"
      ? body.agentSlug.trim()
      : "";
  // `kody` names the built-in identity already supplied by chat defaults. It
  // is not an external AI-agency member and must keep working when that
  // optional catalog is unavailable.
  const agentSlug = requestedAgentSlug === "kody" ? "" : requestedAgentSlug;
  let activeAgentIdentity = chatBundle.agentIdentity;
  type ResolvedAgentMember = Awaited<
    ReturnType<typeof listResolvedAgentFiles>
  >[number];
  let resolvedAgentRoster: ResolvedAgentMember[] = [];
  if (repo && (agentSlug || !clientSurface)) {
    try {
      resolvedAgentRoster = await listResolvedAgentFiles({
        storeFailure: "omit",
      });
    } catch (err) {
      // A missing optional public Kody definition must not break ordinary
      // chat, but an explicitly addressed public Agent still must resolve.
      if (agentSlug) {
        clearGitHubContext();
        throw err;
      }
      traceWarn(
        { traceId, err: formatProviderError(err) },
        "kody-direct: public Agent roster unavailable",
      );
    }
  }
  let addressedAgentMember: ResolvedAgentMember | null = null;
  if (agentSlug) {
    if (!isValidAgentSlug(agentSlug)) {
      clearGitHubContext();
      return NextResponse.json(
        { error: "invalid_agent_slug" },
        { status: 400 },
      );
    }
    if (!repo) {
      return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
    }
    // Resolve from the same merged list that powers the AI Agency picker.
    // A separate point lookup allowed the picker and chat to disagree,
    // surfacing a selectable agent as `agent_not_found` only after send.
    const agentMember = resolvedAgentRoster.find(
      (candidate) => candidate.slug === agentSlug,
    );
    if (!agentMember) {
      clearGitHubContext();
      return NextResponse.json({ error: "agent_not_found" }, { status: 404 });
    }
    activeAgentIdentity = buildAgentChatIdentity(agentMember);
    addressedAgentMember = agentMember;
  }
  const delegatingAgentMember =
    addressedAgentMember ??
    (!clientSurface && !agentSlug
      ? (resolvedAgentRoster.find((candidate) => candidate.slug === "kody") ??
        null)
      : null);
  if (
    durableIdentity &&
    durableIdentity.agent.slug !== (addressedAgentMember?.slug ?? "kody")
  ) {
    clearGitHubContext();
    return NextResponse.json(
      { error: "conversation_agent_mismatch" },
      { status: 400 },
    );
  }
  const startRequestDurableTurn = durableIdentity
    ? () =>
        startDurableTurn(durableIdentity, {
          onProgressError: (error) =>
            traceError(
              { traceId, err: formatProviderError(error) },
              "kody-direct: durable turn progress write failed",
            ),
        })
    : null;

  // Capabilities attached to the agent: load each one's prompt (folded into
  // the agent identity so the model follows it) and its tool names (unioned
  // into the tool allowlist below so the capability's tools survive the
  // bundle filter). Best-effort — a missing capability is skipped.
  let capabilityToolNames: string[] = [];
  if (repo && addressedAgentMember?.capabilities?.length) {
    const caps = (
      await Promise.all(
        addressedAgentMember.capabilities.map((slug) =>
          readCapabilityFile(slug).catch(() => null),
        ),
      )
    ).filter((cap): cap is NonNullable<typeof cap> => cap !== null);
    const capPrompts = caps
      .map((cap) => cap.instructions.trim())
      .filter((p): p is string => !!p);
    if (capPrompts.length > 0) {
      activeAgentIdentity = `${activeAgentIdentity}\n\n${capPrompts.join("\n\n")}`;
    }
    capabilityToolNames = caps.flatMap((cap) =>
      cap.capabilityTools.map((tool) => tool.name),
    );
  }

  // Build the per-request tool set FIRST. The tool list feeds into the
  // system prompt as a `## Tool index` block (item 1 of the accuracy
  // improvements) — the model picks the right tool from the descriptions,
  // not by guessing from names. Tool building requires repo + actor
  // resolution done above.
  const assessmentIntakeRequested = isCompleteProjectAssessmentRequest(
    latestUserText ?? "",
  );
  const blueprintCreationIntakeRequested = isBlueprintCreationIntakeRequest(
    latestUserText ?? "",
  );
  const agencyRequestIntakeRequested =
    !blueprintCreationIntakeRequested &&
    isAgencyRequestIntakeRequest(latestUserText ?? "");
  const requireInteractiveAction =
    !explicitViewRequest &&
    shouldRequireViewOutputForTurn({
      userText: latestUserText,
      definitions: viewRendererDefinitions,
    });
  const requireStructuredView =
    !explicitViewRequest && shouldRequireStructuredViewForTurn(latestUserText);
  const requireViewOutputForTurn =
    requireInteractiveAction || requireStructuredView;
  const requireFollowUpQuestion = shouldRequireFollowUpQuestion(latestUserText);
  let uiToolSet = createUiTools({
    requireInteractiveAction,
    requireFollowUpQuestion,
    userText: latestUserText ?? undefined,
  });
  let extraTools: Record<string, unknown> = {};
  if (repo && !clientSurface) {
    if (verifiedActorGithubId === null) {
      throw new Error("Verified actor is required for repository chat tools");
    }
    // Per-request Octokit (no shared singleton) so the GitHub tools
    // don't race other concurrent /api/kody/chat/kody requests.
    const octokit = createUserOctokit(repo.token);
    uiToolSet = createUiTools({
      viewRendererDefinitions,
      requireInteractiveAction,
      requireFollowUpQuestion,
      userText: latestUserText ?? undefined,
    });
    const workflowApi = createWorkflowApiClient({
      request: repoScopedReq,
      approval: {
        owner: repo.owner,
        repo: repo.repo,
        latestUserText,
      },
    });
    const agencyApi = createAgencyApiClient({
      request: repoScopedReq,
      actorLogin: verifiedActorLogin,
    });
    const repositoryCredentials = new Map<string, KodyRepositoryCredential>();
    for (const credential of storedRepositoryCredentials) {
      repositoryCredentials.set(
        `${credential.owner}/${credential.repo}`.toLowerCase(),
        credential,
      );
    }
    repositoryCredentials.set(`${repo.owner}/${repo.repo}`.toLowerCase(), {
      owner: repo.owner,
      repo: repo.repo,
      token: repo.token,
      actorGithubId: verifiedActorGithubId,
    });
    connectedRepositories = [...repositoryCredentials.values()].map(
      ({ owner, repo: repository }) => ({ owner, repo: repository }),
    );
    const resolveCrossRepository = async (
      repository: { owner: string; repo: string },
      permission: "read" | "write",
    ) => {
      const credential = repositoryCredentials.get(
        `${repository.owner}/${repository.repo}`.toLowerCase(),
      );
      if (!credential) return null;
      const scopedRequest = requestWithAuth(repoScopedReq, {
        owner: credential.owner,
        repo: credential.repo,
        token: credential.token,
        userLogin: verifiedActorLogin ?? undefined,
        storeRepoUrl: repo.storeRepoUrl,
        storeRef: repo.storeRef,
      });
      const access =
        permission === "write"
          ? await verifyRepoWriteAccess(scopedRequest)
          : await verifyRepoReadAccess(scopedRequest);
      if (access instanceof NextResponse) return null;
      const client = createAgencyApiClient({
        request: scopedRequest,
        actorLogin: access.actorLogin,
      });
      return {
        owner: access.auth.owner,
        repo: access.auth.repo,
        actorGithubId: access.actorGithubId,
        readCapability: (slug: string) => client.readCapability(slug),
        saveCapability: (input: Parameters<typeof client.saveCapability>[0]) =>
          client.saveCapability(input),
      };
    };
    const validateAgencyExecution = async (
      execution: NonNullable<AgencyRequestState["execution"]>,
    ) => {
      const normalizedExecution = {
        workflowId: execution.workflowId,
        input: { ...execution.input },
        ...(execution.activations
          ? {
              activations: execution.activations.map((activation) => ({
                kind: activation.kind,
                id: activation.id,
              })),
            }
          : {}),
      };
      const result = await agencyApi.readWorkflow(
        execution.workflowId,
        execution.activations?.some(
          (activation) =>
            activation.kind === "workflow" &&
            activation.id === execution.workflowId,
        ),
      );
      if (typeof result.error === "string") {
        return {
          execution: normalizedExecution,
          issues: [
            `Workflow ${execution.workflowId} could not be read: ${result.error}`,
          ],
        };
      }
      const record =
        result.workflow &&
        typeof result.workflow === "object" &&
        !Array.isArray(result.workflow)
          ? (result.workflow as Record<string, unknown>)
          : null;
      const workflow =
        record?.workflow &&
        typeof record.workflow === "object" &&
        !Array.isArray(record.workflow)
          ? (record.workflow as WorkflowDefinition)
          : null;
      if (!workflow) {
        return {
          execution: normalizedExecution,
          issues: [`Workflow ${execution.workflowId} is unavailable`],
        };
      }
      const input = coerceWorkflowInput(execution.input, workflow.inputSchema);
      return {
        execution: { ...normalizedExecution, input },
        issues: [
          ...validateWorkflowDefinition(workflow),
          ...validateWorkflowInput(input, workflow.inputSchema),
        ].map((issue) => `${issue.path}: ${issue.message}`),
      };
    };
    if (agencyRequestApproval) {
      try {
        return await runApprovedAgencyRequestDirectly({
          approval: agencyRequestApproval,
          runAgencyRequest: (slug) => agencyApi.runAgencyRequest(slug),
        });
      } finally {
        clearGitHubContext();
      }
    }
    if (agencyAssessmentTodoSlug) {
      const assessment = await assessPreparedAgencyRequest(
        agencyAssessmentTodoSlug,
        {
          read: async (slug) => {
            const result = await agencyApi.readTodo(slug);
            const todo =
              result.todo &&
              typeof result.todo === "object" &&
              !Array.isArray(result.todo)
                ? (result.todo as Record<string, unknown>)
                : null;
            if (!todo?.agencyRequest) return null;
            return {
              slug,
              state: todo.agencyRequest as AgencyRequestState,
            };
          },
          validateExecution: validateAgencyExecution,
          save: async (slug, state) => {
            const result = await agencyApi.updateTodo(slug, {
              agencyRequest: state,
            });
            if (typeof result.error === "string") {
              throw new Error(result.error);
            }
          },
        },
      );
      if (assessment.kind === "ready") {
        try {
          return showAgencyRequestApprovalDirectly({
            todoSlug: agencyAssessmentTodoSlug,
          });
        } finally {
          clearGitHubContext();
        }
      }
    }
    extraTools = {
      ...extraTools,
      ...createGitHubTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...createBugTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createTaskTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
        previewContext:
          typeof body.previewContext === "string" ? body.previewContext : null,
      }),
      ...createAgentTools({
        owner: repo.owner,
        repo: repo.repo,
        createAgent: (input) => agencyApi.createAgent(input),
      }),
      ...(!conversationOnlyMemoryRequest
        ? createMemoryTools({
            actorId: verifiedUserId!,
            owner: repo.owner,
            repo: repo.repo,
            ...(typeof body.conversationId === "string"
              ? { conversationId: body.conversationId }
              : {}),
            ...(typeof body.turnId === "string"
              ? { messageId: body.turnId }
              : {}),
          })
        : {}),
      ...createReleaseTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createKodyTools({ octokit, owner: repo.owner, repo: repo.repo }),
      ...createCapabilityTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
        listCapabilities: () => agencyApi.listCapabilities(),
        readCapability: (slug) => agencyApi.readCapability(slug),
        saveCapability: (input) => agencyApi.saveCapability(input),
        removeCapability: (slug) => agencyApi.removeCapability(slug),
        runCapability: (slug) => agencyApi.runCapability(slug),
      }),
      ...createCrossRepositoryCapabilityTools({
        repositories: connectedRepositories,
        actorGithubId: verifiedActorGithubId,
        resolveRepository: resolveCrossRepository,
      }),
      ...createWorkflowTools({
        owner: repo.owner,
        repo: repo.repo,
        listWorkflows: () => workflowApi.list(),
        readWorkflow: (workflowId) => workflowApi.read(workflowId, true),
        saveWorkflow: (input) => agencyApi.saveWorkflow(input),
        removeWorkflow: (workflowId) => agencyApi.removeWorkflow(workflowId),
        runWorkflow: (command) => workflowApi.run(command),
      }),
      ...createSelfConfigurationTools({
        owner: repo.owner,
        repo: repo.repo,
        listCapabilities: () => agencyApi.listCapabilities(),
        readCapability: (slug) => agencyApi.readCapability(slug),
        saveCapability: (input) => agencyApi.saveCapability(input as never),
        removeCapability: (slug) => agencyApi.removeCapability(slug),
        readWorkflow: (id) => workflowApi.read(id, true),
        saveWorkflow: (input) => agencyApi.saveWorkflow(input),
        removeWorkflow: (id) => agencyApi.removeWorkflow(id),
        readLoop: (id) => agencyApi.readLoop(id),
        saveLoop: (input) => agencyApi.saveLoop(input as never),
        removeLoop: (id) => agencyApi.removeLoop(id),
        runWorkflow: (input, options) => workflowApi.run(input, options),
        listRuns: (limit) => agencyApi.listRuns(limit),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      ...createBlueprintTools({
        getBlueprintStatus: () => agencyApi.getBlueprintStatus(),
      }),
      ...createAgencyLifecycleTools({
        owner: repo.owner,
        repo: repo.repo,
        listLoops: () => agencyApi.listLoops(),
        readLoop: (loopId) => agencyApi.readLoop(loopId),
        saveLoop: (input) => agencyApi.saveLoop(input),
        removeLoop: (loopId) => agencyApi.removeLoop(loopId),
        runLoop: (loopId) => agencyApi.runLoop(loopId),
        listIntents: () => agencyApi.listIntents(),
        readIntent: (slug) => agencyApi.readIntent(slug),
        saveIntent: (input) => agencyApi.saveIntent(input),
        removeIntent: (slug) => agencyApi.removeIntent(slug),
        listRuns: (limit) => agencyApi.listRuns(limit),
        readRun: (runId, githubRunId) => agencyApi.readRun(runId, githubRunId),
      }),
      // Dashboard-management tools: let chat manage every dashboard feature
      // (config files, settings, infra) the same way the pages do. Reads use
      // the module-level GitHub context set above; writes pass this octokit.
      ...createCommandTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createContextTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createTodoTools({
        owner: repo.owner,
        repo: repo.repo,
        listTodos: () => agencyApi.listTodos(),
        readTodo: (slug) => agencyApi.readTodo(slug),
        saveTodo: (input) => agencyApi.saveTodo(input),
        patchTodo: (slug, input) => agencyApi.updateTodo(slug, input),
        validateAgencyExecution,
        runAgencyRequest: (slug) => agencyApi.runAgencyRequest(slug),
        removeTodo: (slug) => agencyApi.removeTodo(slug),
      }),
      ...createInstructionsTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createVariableTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createSecretTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
        onSecretWritten: (name) =>
          recordAudit(req, {
            action: "vault.write",
            resource: name,
            detail: "upsert secret via chat",
          }),
      }),
      ...createModelTools({
        octokit,
        owner: repo.owner,
        repo: repo.repo,
        actorLogin: verifiedActorLogin,
      }),
      ...createWebhookTools({
        token: repo.token,
        owner: repo.owner,
        repo: repo.repo,
        hookUrl: `${getPublicBaseUrl(req)}/api/webhooks/github`,
      }),
      ...createAgentAdminTools({
        owner: repo.owner,
        repo: repo.repo,
        listAgents: () => agencyApi.listAgents(),
        readAgent: (slug) => agencyApi.readAgent(slug),
        updateAgent: (slug, input) => agencyApi.updateAgent(slug, input),
        removeAgent: (slug) => agencyApi.removeAgent(slug),
        dispatchAgent: (slug, message) =>
          agencyApi.dispatchAgent(slug, message),
      }),
    };
    // Pipeline tools currently use github-client's module-level context
    // (already set above for the memory index loader) — they do *not* take
    // the per-request octokit. Concurrent requests can race that state;
    // we accept the existing risk to reuse cached helpers.
    extraTools = {
      ...extraTools,
      ...createPipelineTools({ owner: repo.owner, repo: repo.repo }),
    };
  }
  extraTools = {
    ...extraTools,
    ...(!repo && !clientSurface && verifiedUserId
      ? createPersonalChatTools(verifiedUserId)
      : {}),
    ...(!clientSurface
      ? createMachineTools({
          machineAccess: requestedMachineAccess,
          localEnabled: localMachineAccessEnabled,
        })
      : {}),
    ...(!repo &&
    !clientSurface &&
    verifiedUserId &&
    !conversationOnlyMemoryRequest
      ? createMemoryTools({
          actorId: verifiedUserId,
          tenantId: `user:${verifiedUserId}`,
          includeRepositoryScope: false,
          ...(typeof body.conversationId === "string"
            ? { conversationId: body.conversationId }
            : {}),
          ...(typeof body.turnId === "string"
            ? { messageId: body.turnId }
            : {}),
        })
      : {}),
    ...(verifiedUserId
      ? createGuidedFlowTools({
          tenantId: repo
            ? `${repo.owner}/${repo.repo}`
            : `user:${verifiedUserId}`,
          actorId:
            repo && verifiedActorLogin ? verifiedActorLogin : verifiedUserId,
          ...(typeof body.conversationId === "string" &&
          body.conversationId.trim()
            ? { conversationId: body.conversationId.trim() }
            : {}),
        })
      : {}),
  };
  // Optional tool families that failed to load this turn. The model MUST
  // be told about these: a chat that silently lacks its cms/user-state
  // tools invites the model to simulate the calls and report fabricated
  // success (real incident: "saved to CMS with id X" and nothing existed).
  const failedToolFamilies: string[] = [];
  if (repo && !clientSurface) {
    const octokit = createUserOctokit(repo.token);
    // These tool families discover optional configuration through GitHub.
    // A transient GitHub failure must not block the core chat response.
    const loadOptionalTools = async (
      toolFamily: string,
      load: () => Promise<Record<string, unknown>>,
    ): Promise<Record<string, unknown>> => {
      try {
        return await load();
      } catch (err) {
        failedToolFamilies.push(toolFamily);
        traceWarn(
          {
            traceId,
            toolFamily,
            err: err instanceof Error ? err.message : String(err),
          },
          "kody-direct: optional tools unavailable (continuing without them)",
        );
        return {};
      }
    };
    const [cmsTools, userStateTools] = await Promise.all([
      loadOptionalTools("cms", () =>
        createCmsTools({
          req,
          octokit,
          owner: repo.owner,
          repo: repo.repo,
        }),
      ),
      eventUserId
        ? loadOptionalTools("user-state", () =>
            createUserStateTools({
              octokit,
              owner: repo.owner,
              repo: repo.repo,
              userId: eventUserId,
            }),
          )
        : Promise.resolve({}),
    ]);
    extraTools = {
      ...extraTools,
      ...cmsTools,
      ...userStateTools,
      ...(eventUserId
        ? createPositionTools({
            octokit,
            owner: repo.owner,
            repo: repo.repo,
            userId: eventUserId,
          })
        : {}),
    };
  }
  const baseTools: Record<string, unknown> = {
    fetch_url: fetchUrlTool,
    ...featureTools,
    ...uiToolSet,
  };
  // Host/plugin tools enter the same policy and capability pipeline as
  // package-owned tools. This keeps one enforcement path for every tool and
  // prevents host registrations from bypassing implementation restrictions.
  const pluginAiTools: Record<string, unknown> = {};
  if (repo) {
    const pluginToolCtx: ChatToolServerContext = {
      owner: repo.owner,
      repo: repo.repo,
      token: repo.token,
      extras: {
        actorLogin: verifiedActorLogin,
        actorGithubId: verifiedActorGithubId,
      },
    };
    let pluginTools: Record<string, ChatPluginToolDefinition>;
    try {
      pluginTools = getChatServerToolRegistry().collect(pluginToolCtx);
    } catch (err) {
      clearGitHubContext();
      const msg = err instanceof Error ? err.message : String(err);
      traceError(
        { traceId, err: msg },
        "kody-direct: chat plugin tool collect failed",
      );
      return NextResponse.json(
        { error: `chat_plugin_tools_failed: ${msg}` },
        { status: 500 },
      );
    }
    for (const [name, def] of Object.entries(pluginTools)) {
      if (
        Object.prototype.hasOwnProperty.call(baseTools, name) ||
        Object.prototype.hasOwnProperty.call(extraTools, name)
      ) {
        clearGitHubContext();
        traceError(
          { traceId, tool: name },
          "kody-direct: chat plugin tool collides with a built-in tool",
        );
        return NextResponse.json(
          {
            error: `chat_plugin_tool_collision: plugin tool "${name}" collides with a built-in chat tool`,
          },
          { status: 500 },
        );
      }
      pluginAiTools[name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input: unknown) => def.execute(input, pluginToolCtx),
      });
    }
  }
  // Kody chat tool policy (see vibe-tool-policy.ts): strips implementation
  // starters from this endpoint, and strips issue-creation tools in vibe mode
  // once a task is scoped so the model can't file a duplicate.
  const mergedTools = applyVibeToolPolicy(
    { ...baseTools, ...extraTools, ...pluginAiTools },
    { vibeMode, hasCurrentTask: body.task?.issueNumber != null },
  );
  // Bundle allowlist controls domain tools. Core output tools are preserved
  // below because they are the chat protocol, not repo capability surface.
  // Tools declared by the agent's attached capabilities are unioned in so a
  // capability's tools survive the bundle filter (no effect when the bundle
  // list is empty — that already allows all).
  const bundleFilteredTools = filterToolsByAllowlist(
    mergedTools,
    chatBundle.capability.tools.length > 0
      ? [
          ...chatBundle.capability.tools,
          ...capabilityToolNames,
          ...Object.keys(pluginAiTools),
        ]
      : chatBundle.capability.tools,
  );
  // Client-surface scope hard-caps the result at the conservative surface
  // subset (read-only feature discovery + fetch_url). Applied AFTER the
  // bundle allowlist (an empty bundle list means "allow all", so a plain
  // intersection would fail open). Core output tools are re-added below
  // regardless — they are the chat protocol, not capability surface.
  const filteredTools = clientSurface
    ? Object.fromEntries(
        Object.entries(bundleFilteredTools).filter(([name]) =>
          CLIENT_SURFACE_TOOL_ALLOWLIST.includes(name),
        ),
      )
    : bundleFilteredTools;
  let allowlistedTools: Record<string, unknown> = { ...filteredTools };
  for (const name of CHAT_OUTPUT_TOOL_NAMES) {
    if (Object.prototype.hasOwnProperty.call(mergedTools, name)) {
      allowlistedTools[name] = mergedTools[name];
    }
  }
  const browserCapabilityContinuationSlug =
    readPreviewCapabilityContinuation(latestUserText);
  const userBrowserWorkRequested = isUserBrowserWorkRequest({
    userText: latestUserText,
    previewContext:
      typeof body.previewContext === "string" ? body.previewContext : null,
  });
  const userBrowserTurn =
    userBrowserWorkRequested || Boolean(browserCapabilityContinuationSlug);
  // Browser work is its own execution lane. Isolate it before approval,
  // specialist, and prompt construction so unrelated repository tools never
  // enter the model's tool index or become callable during this turn.
  allowlistedTools = isolateUserBrowserTurnTools(
    allowlistedTools,
    userBrowserTurn,
  );
  if (repo && !clientSurface && verifiedActorGithubId !== null) {
    const approvalContext = {
      owner: repo.owner,
      repo: repo.repo,
      actorId: String(verifiedActorGithubId),
    };
    const approvedAction = readToolActionApproval(latestUserText, {
      secret: repo.token,
      context: approvalContext,
    });
    if (approvedAction) {
      try {
        const result = await runApprovedToolAction(approvedAction, mergedTools);
        return createApprovedToolActionResponse(result);
      } finally {
        clearGitHubContext();
      }
    }
    Object.assign(
      allowlistedTools,
      stageToolsForApproval(allowlistedTools, {
        secret: repo.token,
        context: approvalContext,
      }),
    );
  }
  const createRequestToolExecutionScope = () =>
    createToolExecutionScope({
      onError: (name, error) => {
        const message = error instanceof Error ? error.message : String(error);
        traceError(
          { traceId, tool: name, err: message },
          "kody-direct: tool execution failed",
        );
      },
    }).wrap;
  const wrapToolExecution = createRequestToolExecutionScope();

  if (body.retryAssessmentTurnId) {
    if (!durableIdentity || !repo) {
      clearGitHubContext();
      return NextResponse.json(
        { error: "assessment_retry_requires_conversation" },
        { status: 400 },
      );
    }
    const backend = createBackendClient();
    const failedTurn = await backend.query(backendApi.conversationTurns.get, {
      tenantId: durableIdentity.tenantId,
      conversationId: durableIdentity.conversationId,
      turnId: body.retryAssessmentTurnId,
    });
    const recovery = failedTurn?.recovery as
      ProjectAssessmentSynthesisRecovery | undefined;
    if (
      failedTurn?.status !== "failed" ||
      failedTurn.errorCode !== "specialist_synthesis_failed" ||
      recovery?.kind !== "project-assessment-synthesis" ||
      recovery.version !== 1 ||
      recovery.repository.owner !== repo.owner ||
      recovery.repository.repo !== repo.repo
    ) {
      clearGitHubContext();
      return NextResponse.json(
        { error: "assessment_retry_not_available" },
        { status: 409 },
      );
    }
    const durableTurn = startRequestDurableTurn?.();
    await durableTurn?.saveRecovery(recovery);
    const answer = await retryProjectAssessmentSynthesis({
      recovery,
      model,
      onSynthesisFailure: (error) =>
        traceError(
          { traceId, err: formatProviderError(error) },
          "kody-direct: assessment writer-only retry failed",
        ),
    });
    const published = await publishProjectAssessmentReport({
      answer,
      repository: recovery.repository,
      publishTool: mergedTools.publish_report as
        | {
            execute?: (input: {
              slug: string;
              title: string;
              body: string;
            }) => Promise<unknown> | unknown;
          }
        | undefined,
    });
    const writingFailed = published.answer.startsWith(
      PROJECT_ASSESSMENT_SYNTHESIS_FAILURE_PREFIX,
    );
    const finalAnswer =
      !writingFailed && !published.published
        ? "Final report writing failed: the draft was complete, but saving the report failed. The same-run specialist findings were preserved for another writer-only retry."
        : published.answer;
    if (writingFailed || !published.published) {
      await durableTurn?.fail(
        writingFailed
          ? "specialist_synthesis_failed"
          : "assessment_publish_failed",
        finalAnswer,
      );
    } else {
      await durableTurn?.complete(finalAnswer);
      await backend.mutation(backendApi.conversationTurns.clearRecovery, {
        tenantId: durableIdentity.tenantId,
        conversationId: durableIdentity.conversationId,
        turnId: body.retryAssessmentTurnId,
        updatedAt: new Date().toISOString(),
      });
    }
    clearGitHubContext();
    const uiStream = createUIMessageStream({
      execute: ({ writer }) => {
        const id = `assessment-retry-${durableIdentity.turnId}`;
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: finalAnswer });
        writer.write({ type: "text-end", id });
      },
    });
    return createUIMessageStreamResponse({ stream: uiStream });
  }

  const assignedSubagentSlugs = delegatingAgentMember?.subagents ?? [];
  const assignedSubagentRoster = resolvedAgentRoster.filter((candidate) =>
    assignedSubagentSlugs.includes(candidate.slug),
  );
  const specialistUserText =
    typeof body.previewContext === "string" && body.previewContext.trim()
      ? `${latestUserText ?? ""}\n\n${body.previewContext.trim()}`
      : (latestUserText ?? "");
  if (!clientSurface && !userBrowserTurn && assignedSubagentRoster.length > 0) {
    allowlistedTools.request_specialist_evidence =
      createPublicAgentEvidenceTool({
        agents: assignedSubagentRoster,
        run: (assignments, abortSignal) =>
          runConfiguredPublicAgentAssignments({
            assignments,
            abortSignal,
            sharedContext: specialistUserText,
            assignedAgents: assignedSubagentRoster,
            model,
            availableTools: allowlistedTools,
            specialistTools: mergedTools,
            loadCapabilities: async (agent) =>
              (
                await Promise.all(
                  (agent.capabilities ?? []).map(async (slug) => {
                    const capability =
                      readBuiltinAgentCapability(slug) ??
                      (await readResolvedCapabilityFile(slug).catch(
                        () => null,
                      ));
                    return capability ? { slug, ...capability } : null;
                  }),
                )
              ).filter((cap): cap is NonNullable<typeof cap> => cap !== null),
            createToolExecutionScope: createRequestToolExecutionScope,
            repository: repo ? { owner: repo.owner, repo: repo.repo } : null,
            maxSteps: Math.min(
              resolvedModel.maxSteps ?? PUBLIC_AGENT_DEFAULT_MAX_STEPS,
              PUBLIC_AGENT_DEFAULT_MAX_STEPS,
            ),
            providerCapabilities,
          }),
      });
    turnSystemInstructions.push(
      "You own this complete turn. Answer from authoritative current context or use your own tools for Kody-owned work. Call request_specialist_evidence only when assigned specialist expertise or independent evidence is genuinely needed, then continue this same turn and make the final decision yourself. Never expose specialist routing mechanics.",
    );
  }
  const clearlyConversationalTurn = isClearlyConversationalTurn(
    latestUserText ?? "",
  );
  if (assessmentIntakeRequested) {
    turnSystemInstructions.push(
      `Start the built-in GuidedFlow \`${PROJECT_ASSESSMENT_FLOW_ID}\` with \`guided_flow_start\`. Do not begin assessment work and do not recreate the questions with \`show_view\`; the GuidedFlow owns intake and starts the assessment only after its last step.`,
    );
  }
  if (agencyRequestIntakeRequested) {
    turnSystemInstructions.push(
      `Start the built-in GuidedFlow \`${NEW_AGENCY_REQUEST_FLOW_ID}\` with \`guided_flow_start\` now. Do not delegate, inspect, execute, or recreate the questions with \`show_view\` before intake; the GuidedFlow collects the user's durable automation requirement and hands the completed request back to Kody for assessment.`,
    );
  }
  if (blueprintCreationIntakeRequested) {
    turnSystemInstructions.push(
      `Start the built-in GuidedFlow \`${CREATE_BLUEPRINT_FLOW_ID}\` with \`guided_flow_start\` now. Do not recreate its questions with \`show_view\`. The GuidedFlow and your reasoning use this same Request Blueprint:\n${CREATE_BLUEPRINT_MODEL_GUIDE}`,
    );
  }
  if (
    clearlyConversationalTurn &&
    Object.prototype.hasOwnProperty.call(allowlistedTools, FINAL_ANSWER_TOOL)
  ) {
    for (const name of Object.keys(allowlistedTools)) {
      if (name !== FINAL_ANSWER_TOOL) delete allowlistedTools[name];
    }
    turnSystemInstructions.push(
      "Answer this conversational message directly. Do not infer Kody's overall capabilities from this turn's reduced tool list, and do not claim Kody cannot perform actions unless the user asked for a specific action that is unavailable.",
    );
  }
  // Tool failures must become tool results, not stream-level failures. The
  // client can then show the real reason and the model can correct its input
  // instead of every provider collapsing the error to "An error occurred."
  for (const [name, candidate] of Object.entries(allowlistedTools)) {
    allowlistedTools[name] = wrapToolExecution(name, candidate);
  }
  const tools = allowlistedTools as Parameters<typeof streamText>[0]["tools"];
  const requireViewOutput =
    requireViewOutputForTurn &&
    Object.prototype.hasOwnProperty.call(allowlistedTools, SHOW_VIEW_TOOL);
  const maxTurnSteps = resolvedModel.maxSteps ?? DEFAULT_MAX_STEPS;
  const allActiveTools = Object.keys(allowlistedTools) as Array<
    keyof NonNullable<typeof tools>
  >;
  const requireBrowserCapabilityDiscovery = userBrowserWorkRequested;
  // Some providers stream several tool rounds without reflecting completed
  // results in prepareStep's `steps` array. Track the actual result stream so
  // Agency assessment still reaches its mandatory decision boundary.
  let agencyAssessmentReadResultsSeen = 0;
  let agencyAssessmentUpdatedSeen = false;
  let browserCapabilitiesListedSeen = false;
  let userBrowserCapabilityReadSeen = false;
  const forceGuidedFlowIntake =
    (assessmentIntakeRequested ||
      agencyRequestIntakeRequested ||
      blueprintCreationIntakeRequested) &&
    allActiveTools.includes("guided_flow_start");
  const shouldAllowPreRenderTools =
    requireViewOutput &&
    shouldAllowPreRenderToolCallsForTurn({
      userText: latestUserText,
      toolNames: Object.keys(allowlistedTools),
    });
  const forceShowViewTool =
    Boolean(explicitViewRequest) &&
    Object.prototype.hasOwnProperty.call(allowlistedTools, SHOW_VIEW_TOOL);
  if (explicitViewRequest && !forceShowViewTool) {
    turnSystemInstructions.push(
      "The latest user message asks to render a UI card, but `show_view` is not available in this chat's tool set. Tell the user the UI tool is unavailable; do not claim the card was rendered.",
    );
  } else if (explicitViewRequest) {
    turnSystemInstructions.push(
      buildExplicitViewRequestInstruction(explicitViewRequest),
    );
  } else if (requireViewOutput) {
    turnSystemInstructions.push(
      requireStructuredView && !requireInteractiveAction
        ? "The latest user message asks to present structured data. Use read/list tools first if needed, then finish this turn with `show_view` as a clear non-interactive view. Do not invent controls or finish with `final_answer`."
        : "The latest user message asks for an interactive response that matches the available renderer rules. Use read/list tools first if needed, then finish this turn with `show_view`. Do not finish with `final_answer`.",
    );
  }
  if (failedToolFamilies.length > 0) {
    turnSystemInstructions.push(
      `Tool families UNAVAILABLE this turn (their configuration failed to load): ${failedToolFamilies.join(", ")}. ` +
        "If the user asks for a related action, state plainly that the tools are unavailable right now and suggest retrying. " +
        "NEVER simulate these tool calls, never invent ids or results, and never claim data was read or written.",
    );
  }

  // Build the system prompt. The tool index (name + description) is
  // computed from the FINAL allowlisted tools and injected into the
  // bundle's base prompt — the model sees a `## Tool index` block
  // listing every callable with a one-sentence description, so it
  // picks the right tool instead of guessing by name.
  const toolIndex = buildToolIndex(allowlistedTools);

  const basePrompt = composeBasePrompt(
    { ...chatBundle, agentIdentity: activeAgentIdentity },
    { toolIndex },
  );
  const assembledPrompt = buildSystemPrompt(
    basePrompt,
    repo ? { owner: repo.owner, repo: repo.repo } : null,
    body.task,
    {
      capability: body.capability,
      report: body.report,
      app: body.app,
      connectedRepositories,
      org: body.org,
      currentPage: body.currentPage,
      previewContext:
        typeof body.previewContext === "string"
          ? body.previewContext
          : undefined,
      memoryContext,
      vibeMode,
      flyConfigured,
      userInstructions: null,
      context,
      constraints,
      policies,
      viewRendererRules,
    },
  );

  // Critical reminders stay near the end for recency, but repo instructions
  // come after them so per-repo tone/audience rules still win. The voice
  // overlay remains the final modality-specific override.
  const userInstructionsSection =
    formatUserInstructionsPromptSection(userInstructions);
  const conversationSummarySection = body.conversationSummary?.trim()
    ? `## Earlier conversation memory\n\n${body.conversationSummary.trim()}`
    : null;
  const promptWithReminders = [
    assembledPrompt,
    featureGuidePromptSection,
    conversationSummarySection,
    voiceMode ? null : CRITICAL_REMINDERS_MD,
    userInstructionsSection,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
  const promptWithSpeakerOverride = appendAgentChatSpeakerOverride(
    promptWithReminders,
    addressedAgentMember,
  );
  const verifiedAgentHandoff = resolveAgentHandoffForPrompt(
    body.agentHandoff,
    addressedAgentMember
      ? {
          slug: addressedAgentMember.slug,
          title: addressedAgentMember.title,
        }
      : { slug: "kody", title: "Kody" },
  );
  const promptWithAgentHandoff = verifiedAgentHandoff
    ? [
        promptWithSpeakerOverride,
        buildAgentHandoffPrompt(verifiedAgentHandoff),
        typeof body.agentHandoffContext === "string" &&
        body.agentHandoffContext.trim()
          ? buildPreviousAgentContextPrompt(body.agentHandoffContext.trim())
          : null,
      ]
        .filter((section): section is string => Boolean(section))
        .join("\n\n")
    : promptWithSpeakerOverride;

  // Voice modality is layered onto the FULLY-ASSEMBLED prompt, appended
  // LAST so its rules ("no markdown, short sentences, symbols-as-words")
  // win by recency over the research/issue-creation/memory blocks above
  // which otherwise teach the model to reply in bullet-heavy markdown.
  // The agent's brain and tools are untouched — the user picks the brain
  // in the dropdown; only the output shape changes.
  const systemPrompt = applyVoiceOverlay(promptWithAgentHandoff, voiceMode);
  const groundedSystemPrompt = hasImageParts
    ? `${systemPrompt}

## Image input rule

This turn includes an image from the user. For questions about what is visible in the image, answer from the attached image itself. Do not substitute current page context, task context, memory, or prior turns when they conflict with the image. If the image is unreadable or unavailable, say that instead of guessing.`
    : systemPrompt;
  const buildTurnSystemPrompt = (additionalInstructions: string[] = []) =>
    [groundedSystemPrompt, ...turnSystemInstructions, ...additionalInstructions]
      .filter((section) => section.trim().length > 0)
      .join("\n\n");

  // Build a tool-name → description map from the merged tool set. Every
  // tool in this repo calls `tool({ description, inputSchema, execute })`
  // from the AI SDK, which returns a runtime object with `description` as
  // a first-class field. We ship the map to the client as a single
  // `data-tools-index` event at the start of the stream so the thinking
  // panel can render the tool description (the same string the model uses
  // to decide whether to call a tool) as a muted one-liner under the tool
  // name. One event for the whole turn, not one per call — see issue #321.
  // Brain/Engine chats don't populate this; the client field is optional
  // and the card gracefully omits the line when missing.
  const toolDescriptionByName: Record<string, string> = {};
  for (const [name, t] of Object.entries(tools ?? {})) {
    const desc =
      t && typeof t === "object" && "description" in t
        ? (t as { description?: unknown }).description
        : undefined;
    if (typeof desc === "string" && desc.trim().length > 0) {
      toolDescriptionByName[name] = desc;
    }
  }

  let stepNum = 0;

  // Heartbeat warnings. If no step has finished by T+30s/T+60s, log a
  // warning so we can spot first-step stalls (the model taking forever before
  // any tokens / tool calls). Cleared at first step finish, completion, or
  // any error path. Declared outside the try so the catch can clear them.
  const heartbeats: NodeJS.Timeout[] = [];
  const armHeartbeat = (ms: number) => {
    heartbeats.push(
      setTimeout(() => {
        if (stepNum === 0) {
          traceWarn(
            { traceId, elapsedMs: ms, messageCount: messages.length, modelId },
            "kody-direct: no step finished yet (model may be stuck before first token)",
          );
        }
      }, ms),
    );
  };
  const clearHeartbeats = () => {
    for (const h of heartbeats) clearTimeout(h);
    heartbeats.length = 0;
  };

  let durableTurn: DurableTurn | null = null;
  if (startRequestDurableTurn) {
    try {
      durableTurn = startRequestDurableTurn();
    } catch (error) {
      traceError(
        { traceId, err: formatProviderError(error) },
        "kody-direct: durable turn setup failed",
      );
    }
  }
  const durableProgress = createDurableTurnProgressRecorder(durableTurn);
  const toolArguments = (input: unknown): Record<string, unknown> =>
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  try {
    traceLog(
      {
        traceId,
        modelId,
        messageCount: messages.length,
        trimmedFromHistory: trimmedCount,
        repo: repo ? `${repo.owner}/${repo.repo}` : null,
        task: body.task?.issueNumber ?? null,
        toolCount: Object.keys(tools ?? {}).length,
      },
      "kody-direct: streaming",
    );
    armHeartbeat(30_000);
    armHeartbeat(60_000);
    const runModelTurn = (
      turnMessages: typeof modelMessages,
      additionalSystemInstructions: string[] = [],
    ) =>
      streamText({
        model,
        abortSignal: req.signal,
        system: buildTurnSystemPrompt(additionalSystemInstructions),
        messages: turnMessages,
        tools,
        ...(forceShowViewTool
          ? {
              toolChoice: selectChatOutputToolChoice(
                [SHOW_VIEW_TOOL],
                providerCapabilities,
              ),
            }
          : {
              toolChoice: providerCapabilities.supportsRequiredToolChoice
                ? ("required" as const)
                : ("auto" as const),
            }),
        ...(!forceShowViewTool
          ? {
              prepareStep: ({ steps }) => {
                if (agencyRequestApproval?.action === "approve") {
                  const started = steps.some((step) =>
                    step.toolResults.some(
                      (result) =>
                        result.toolName === "run_agency_request" &&
                        !isToolErrorOutput(result.output),
                    ),
                  );
                  if (!started) {
                    return {
                      activeTools: ["run_agency_request"],
                      toolChoice: selectChatOutputToolChoice(
                        ["run_agency_request"],
                        providerCapabilities,
                      ),
                    };
                  }
                  return {
                    activeTools: [FINAL_ANSWER_TOOL],
                    toolChoice: selectChatOutputToolChoice(
                      [FINAL_ANSWER_TOOL],
                      providerCapabilities,
                    ),
                  };
                }
                if (forceGuidedFlowIntake && steps.length === 0) {
                  return {
                    activeTools: ["guided_flow_start"],
                    toolChoice: selectChatOutputToolChoice(
                      ["guided_flow_start"],
                      providerCapabilities,
                    ),
                  };
                }
                if (
                  requireBrowserCapabilityDiscovery ||
                  browserCapabilityContinuationSlug
                ) {
                  const capabilitiesListed =
                    browserCapabilitiesListedSeen ||
                    steps.some((step) =>
                      step.toolResults.some(
                        (result) => result.toolName === "list_capabilities",
                      ),
                    );
                  const userBrowserCapabilityRead =
                    userBrowserCapabilityReadSeen ||
                    steps.some((step) =>
                      step.toolResults.some(
                        (result) =>
                          result.toolName === "read_capability" &&
                          isUserBrowserCapabilityReadResult(result.output),
                      ),
                    );
                  const browserActiveTools = selectUserBrowserActiveTools({
                    requested: requireBrowserCapabilityDiscovery,
                    continuation: Boolean(browserCapabilityContinuationSlug),
                    capabilitiesListed,
                    browserCapabilityRead: userBrowserCapabilityRead,
                    availableTools: allActiveTools,
                  }) as Array<keyof NonNullable<typeof tools>> | null;
                  if (browserActiveTools?.length) {
                    return {
                      activeTools: browserActiveTools,
                      toolChoice: selectChatOutputToolChoice(
                        browserActiveTools,
                        providerCapabilities,
                      ),
                    };
                  }
                }
                if (agencyAssessmentHandoffRequested) {
                  const agencyAssessmentUpdated =
                    agencyAssessmentUpdatedSeen ||
                    steps.some((step) =>
                      step.toolResults.some(
                        (result) =>
                          result.toolName === "update_agency_request" &&
                          !isToolErrorOutput(result.output),
                      ),
                    );
                  const agencyAssessmentReadResults = Math.max(
                    agencyAssessmentReadResultsSeen,
                    steps.reduce(
                      (count, step) =>
                        count +
                        step.toolResults.filter(
                          (result) =>
                            result.toolName !== "update_agency_request" &&
                            result.toolName !== SHOW_VIEW_TOOL &&
                            result.toolName !== FINAL_ANSWER_TOOL,
                        ).length,
                      0,
                    ),
                  );
                  const agencyAssessmentTools = agencyAssessmentUpdated
                    ? allActiveTools.filter((name) => name === SHOW_VIEW_TOOL)
                    : agencyAssessmentReadResults >=
                        MAX_AGENCY_ASSESSMENT_READ_RESULTS
                      ? allActiveTools.filter(
                          (name) => name === "update_agency_request",
                        )
                      : allActiveTools.filter(
                          (name) =>
                            /^(?:list|read|get|search|fetch)_/.test(name) ||
                            name === "update_agency_request",
                        );
                  return {
                    activeTools: agencyAssessmentTools,
                    toolChoice: selectChatOutputToolChoice(
                      agencyAssessmentTools,
                      providerCapabilities,
                    ),
                  };
                }
                if (
                  explicitMemoryCommand &&
                  steps.length === 0 &&
                  allActiveTools.includes("remember")
                ) {
                  return {
                    activeTools: ["remember"],
                    toolChoice:
                      providerCapabilities.supportsNamedToolChoice !== false
                        ? {
                            type: "tool" as const,
                            toolName: "remember" as const,
                          }
                        : ("required" as const),
                  };
                }
                const missingFollowUp = steps.some((step) =>
                  step.toolResults.some(
                    (result) =>
                      result.toolName === FINAL_ANSWER_TOOL &&
                      getToolErrorMessage(result.output) ===
                        FINAL_ANSWER_FOLLOW_UP_ERROR,
                  ),
                );
                if (missingFollowUp) {
                  return {
                    activeTools: [FINAL_ANSWER_TOOL],
                    toolChoice: selectChatOutputToolChoice(
                      [FINAL_ANSWER_TOOL],
                      providerCapabilities,
                    ),
                    system: buildTurnSystemPrompt([
                      `Your final_answer was rejected because it had no follow-up question. ${FOLLOW_UP_QUESTION_CONTRACT} Do not call show_view for this correction.`,
                    ]),
                  };
                }
                if (
                  !requireViewOutput &&
                  steps.length >= maxTurnSteps - 1 &&
                  allActiveTools.includes(FINAL_ANSWER_TOOL)
                ) {
                  return {
                    activeTools: [FINAL_ANSWER_TOOL],
                    toolChoice: selectChatOutputToolChoice(
                      [FINAL_ANSWER_TOOL],
                      providerCapabilities,
                    ),
                    system: buildTurnSystemPrompt([
                      `This is the final available step. Stop researching and call final_answer now with the best verified answer available. ${FOLLOW_UP_QUESTION_CONTRACT}`,
                    ]),
                  };
                }
                const hasPreRenderToolResult = steps.some((step) =>
                  step.toolResults.some(
                    (result) =>
                      result.toolName !== SHOW_VIEW_TOOL &&
                      result.toolName !== FINAL_ANSWER_TOOL,
                  ),
                );
                const rejectedUnboundApproval = steps.some((step) =>
                  step.toolResults.some(
                    (result) =>
                      result.toolName === SHOW_VIEW_TOOL &&
                      getToolErrorMessage(result.output)?.includes(
                        "not bound to an action",
                      ),
                  ),
                );
                // Some models (observed: MiniMax-M3) write tool calls as
                // literal text instead of API tool calls — nothing executes,
                // then they report fabricated results. Bounce it immediately:
                // the next step starts with a corrective system message.
                const lastStep = steps[steps.length - 1];
                const fabricatedToolCall = containsToolCallMarkup(
                  lastStep?.text,
                  lastStep?.reasoningText,
                );
                if (fabricatedToolCall) {
                  traceWarn(
                    { traceId, step: steps.length },
                    "kody-direct: textual tool-call markup detected (bouncing)",
                  );
                }
                const stepActiveTools = rejectedUnboundApproval
                  ? allActiveTools.filter(
                      (toolName) =>
                        toolName !== SHOW_VIEW_TOOL &&
                        toolName !== FINAL_ANSWER_TOOL,
                    )
                  : selectChatOutputActiveTools({
                      toolNames: allActiveTools,
                      requireViewOutput,
                      allowPreRenderTools:
                        shouldAllowPreRenderTools && !hasPreRenderToolResult,
                    });
                return {
                  activeTools: stepActiveTools,
                  // Pin show_view by name when it is the only allowed tool —
                  // some providers ignore the generic "required" and finish
                  // with prose, ending the turn with nothing visible.
                  toolChoice: selectChatOutputToolChoice(
                    stepActiveTools,
                    providerCapabilities,
                  ),
                  ...(fabricatedToolCall
                    ? {
                        system: buildTurnSystemPrompt([
                          "Your previous message wrote a tool invocation as PLAIN TEXT. It did NOT execute — no tool ran, no data was read or written, and any id you produced is fabricated. Retract any claimed result and re-issue the operation as a REAL tool call through the API, or tell the user it could not be performed.",
                        ]),
                      }
                    : rejectedUnboundApproval
                      ? {
                          system: buildTurnSystemPrompt([
                            "The approval UI was rejected because it was not bound to a real operation. UI and prose tools are now unavailable for this recovery step. Call the matching repository action tool with the exact prepared input; do not delegate or simulate the action.",
                          ]),
                        }
                      : {}),
                };
              },
            }
          : {}),
        // Optimized for deep analysis: see DEFAULT_MAX_STEPS for the cap
        // rationale and the per-model override path. The constant lives at
        // module level so tests can assert the value.
        stopWhen: [
          permanentToolFailureResult(),
          // User-browser actions are UI directives, not page results. End
          // this model turn so the Dashboard can execute exactly one action
          // and feed its fresh snapshot into the next hidden turn.
          successfulToolResult("browser_capability_act"),
          ...(agencyAssessmentHandoffRequested
            ? [successfulToolResult("update_agency_request")]
            : []),
          settledToolAttempts(SHOW_VIEW_TOOL, MAX_SHOW_VIEW_ATTEMPTS),
          successfulToolResult(FINAL_ANSWER_TOOL),
          successfulRenderedViewResult(),
          stepCountIs(maxTurnSteps),
        ],
        // Per-provider thinking config so reasoning-delta chunks actually
        // reach the client. Without this, `sendReasoning: true` below has
        // nothing to stream and the chat looks idle until the final answer.
        // Voice mode skips reasoning entirely — the voice overlay forbids
        // reading anything other than the final answer, and the chat client
        // also drops reasoning chunks defensively in this mode.
        // `applyReasoning` is the single source of truth for the
        // effort→wire-shape translation; the user-picked level is forwarded
        // as `body.reasoningEffort` and validated against the model's
        // declared `efforts` list. Returns `{}` for models that don't
        // reason, so non-reasoning providers stay untouched.
        ...(voiceMode
          ? {}
          : applyReasoning(resolvedModel, body.reasoningEffort)),
        onChunk: ({ chunk }) => {
          if (chunk.type === "reasoning-delta") {
            if (!voiceMode) durableProgress.appendReasoning(chunk.text);
            return;
          }
          if (
            chunk.type === "tool-call" &&
            chunk.toolName !== FINAL_ANSWER_TOOL
          ) {
            durableProgress.upsertTool({
              id: chunk.toolCallId,
              name: chunk.toolName,
              arguments: toolArguments(chunk.input),
              status: "running",
              ...(toolDescriptionByName[chunk.toolName]
                ? { description: toolDescriptionByName[chunk.toolName] }
                : {}),
            });
            return;
          }
          if (
            chunk.type === "tool-result" &&
            chunk.toolName !== FINAL_ANSWER_TOOL
          ) {
            if (
              chunk.toolName === "list_capabilities" &&
              !isToolErrorOutput(chunk.output)
            ) {
              browserCapabilitiesListedSeen = true;
            } else if (
              chunk.toolName === "read_capability" &&
              isUserBrowserCapabilityReadResult(chunk.output)
            ) {
              userBrowserCapabilityReadSeen = true;
            }
            if (agencyAssessmentHandoffRequested) {
              if (
                chunk.toolName === "update_agency_request" &&
                !isToolErrorOutput(chunk.output)
              ) {
                agencyAssessmentUpdatedSeen = true;
              } else if (chunk.toolName !== SHOW_VIEW_TOOL) {
                agencyAssessmentReadResultsSeen += 1;
              }
            }
            durableProgress.finishTool(chunk.toolCallId, "success");
          }
        },
        // Per-tool tracing. `experimental_onToolCallStart` fires before the
        // tool's `execute` is invoked; `experimental_onToolCallFinish`
        // afterward with the SDK-measured `durationMs` and a success flag.
        // Together with onStepFinish they give us a per-step, per-tool view
        // of where time goes.
        experimental_onToolCallStart: ({ toolCall }) => {
          traceLog(
            {
              traceId,
              tool: toolCall.toolName,
              toolCallId: toolCall.toolCallId,
            },
            "kody-direct: tool start",
          );
        },
        experimental_onToolCallFinish: (event) => {
          if (!event.success) {
            durableProgress.finishTool(event.toolCall.toolCallId, "error");
          }
          const base = {
            traceId,
            tool: event.toolCall.toolName,
            toolCallId: event.toolCall.toolCallId,
            durationMs: event.durationMs,
          };
          if (event.success) {
            traceLog(base, "kody-direct: tool ok");
          } else {
            traceWarn(
              {
                ...base,
                err:
                  event.error instanceof Error
                    ? event.error.message
                    : String(event.error),
              },
              "kody-direct: tool error",
            );
          }
        },
        onStepFinish: (step) => {
          stepNum++;
          if (stepNum === 1) clearHeartbeats();
          traceLog(
            {
              traceId,
              step: stepNum,
              finishReason: step.finishReason,
              toolCalls: step.toolCalls?.map((c) => c.toolName) ?? [],
              usage: step.usage,
            },
            "kody-direct: step finish",
          );
        },
        onError: ({ error }) => {
          clearHeartbeats();
          if (durableTurn) {
            void durableTurn
              .fail("provider_error")
              .catch((persistenceError) => {
                traceError(
                  { traceId, err: formatProviderError(persistenceError) },
                  "kody-direct: durable turn failure write failed",
                );
              });
          }
          // Server-side log of stream errors. We *also* surface the message
          // to the UI via the `onError` arg to toUIMessageStreamResponse
          // below, so the user sees what happened instead of a silent hang.
          traceError(
            {
              traceId,
              modelId,
              err: formatProviderError(error),
              ...extractProviderErrorMeta(error),
            },
            "kody-direct: stream onError",
          );
        },
        onFinish: async (event) => {
          clearHeartbeats();
          clearGitHubContext();
          if (durableTurn) {
            const finalToolAnswer = event.steps
              .flatMap((step) => step.toolResults)
              .find(
                (result) =>
                  result.toolName === FINAL_ANSWER_TOOL &&
                  isFinalAnswerOutput(result.output),
              );
            const content =
              finalToolAnswer && isFinalAnswerOutput(finalToolAnswer.output)
                ? finalToolAnswer.output.content
                : event.text.trim();
            try {
              if (content) await durableTurn.complete(content);
              else await durableTurn.fail("empty_response");
            } catch (error) {
              traceError(
                { traceId, err: formatProviderError(error) },
                "kody-direct: durable turn completion failed",
              );
            }
          }
          traceLog(
            {
              traceId,
              steps: stepNum,
              finishReason: event.finishReason,
              totalDuration: Date.now() - reqStartedAt,
              usage: event.usage,
            },
            "kody-direct: finish",
          );
        },
      });
    const result = runModelTurn(modelMessages);
    void result.consumeStream({
      onError: (error) => {
        traceError(
          { traceId, err: formatProviderError(error) },
          "kody-direct: detached stream consumption failed",
        );
      },
    });
    const formatUIStreamError = (error: unknown): string =>
      `[trace ${traceId}] ${formatProviderError(error)}`;
    // Prepend a single `data-tools-index` event to the UI stream so the
    // client can hydrate a name→description lookup for the thinking panel.
    // One event for the whole turn (not one per tool call) — see the
    // `toolDescriptionByName` build above for the why. We do this through
    // `createUIMessageStream` so the description map is the first chunk the
    // client sees; the rest of the stream is the same `result.toUIMessageStream`
    // the SDK would have produced on its own.
    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        publishAutomaticFallback = (event) => {
          writer.write({ type: "data-automatic-fallback", data: event });
        };
        for (const event of pendingAutomaticFallbacks.splice(0)) {
          publishAutomaticFallback(event);
        }
        writer.write({
          type: "data-tools-index",
          data: toolDescriptionByName,
        });
        if (
          requireViewOutput ||
          providerCapabilities.supportsRequiredToolChoice !== false
        ) {
          // Required tool choice makes raw provider prose non-final. Tell the
          // transport to expose only the semantic final_answer/show_view
          // result, so a renderer can never erase text the user already saw.
          writer.write({
            type: CHAT_OUTPUT_CONTRACT_DATA_TYPE,
            data: { mode: EXCLUSIVE_TOOL_OUTPUT_MODE },
          });
        }
        writer.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            onError: formatUIStreamError,
          }),
        );
        // Silent-turn retry: some providers (observed: MiniMax-M3)
        // intermittently burn the whole turn inside thinking and finish
        // with no tool call and no visible text — even with a pinned
        // tool choice (confirmed at the wire level). Each attempt is an
        // independent sample, so up to two corrective follow-up turns
        // are merged into the same UI stream before giving up.
        try {
          let attempt = result;
          let attemptMessages = modelMessages;
          let malformedToolRetryDeadline: number | null = null;
          for (
            let retryCount = 0;
            retryCount <= MAX_SILENT_TURN_RETRIES;
            retryCount += 1
          ) {
            const steps = await attempt.steps;
            const permanentFailure = findPermanentToolFailure(steps);
            if (permanentFailure) {
              if (
                isRecoverableRepositoryReadFailure(permanentFailure) &&
                retryCount < MAX_SILENT_TURN_RETRIES
              ) {
                const completedAttemptMessages = (await attempt.response)
                  ?.messages;
                if (completedAttemptMessages?.length) {
                  attemptMessages = trimToRecent([
                    ...attemptMessages,
                    ...completedAttemptMessages,
                  ]);
                }
                attempt = runModelTurn(attemptMessages, [
                  "A repository search or capability-list API was unavailable. Continue using the repository tree and direct file reads, including .kody-engine/definitions/capabilities when capability slugs are needed. Report only facts directly observed in those files; do not return the API error as the answer.",
                ]);
                continue;
              }
              const content = formatPermanentToolFailure(permanentFailure);
              const toolCallId = `permanent-tool-failure-${traceId}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: FINAL_ANSWER_TOOL,
                input: { content },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: { content },
              });
              return;
            }
            // A rendered-view directive from ANY tool (e.g.
            // guided_flow_start) is the turn's visible output.
            const producedOutputTool = hasVisibleChatToolOutput(steps);
            const savedAgencyAssessment = steps.some((step) =>
              step.toolResults.some(
                (stepResult) =>
                  stepResult.toolName === "update_agency_request" &&
                  !isToolErrorOutput(stepResult.output),
              ),
            );
            if (
              agencyAssessmentTodoSlug &&
              savedAgencyAssessment &&
              !producedOutputTool
            ) {
              const toolCallId = `agency-approval-${traceId}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: SHOW_VIEW_TOOL,
                input: { purpose: "approval-card" },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: createAgencyRequestApproval({
                  todoSlug: agencyAssessmentTodoSlug,
                }),
              });
              return;
            }
            const visibleAnswer = parseReasoning(
              steps.map((step) => step.text ?? "").join(""),
            ).answer.trim();
            const wroteTextualToolCall = containsToolCallMarkup(
              ...steps.flatMap((step) => [step.text, step.reasoningText]),
            );
            if (wroteTextualToolCall && malformedToolRetryDeadline === null) {
              malformedToolRetryDeadline = retryCount + 1;
            }
            const retryDeadline =
              malformedToolRetryDeadline ?? MAX_SILENT_TURN_RETRIES;
            if (
              requireViewOutput &&
              !producedOutputTool &&
              retryCount >= retryDeadline
            ) {
              const content = getViewRecoveryContent(visibleAnswer);
              const toolCallId = `view-recovery-${traceId}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: FINAL_ANSWER_TOOL,
                input: { content },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: { content },
              });
              return;
            }
            if (
              !requireViewOutput &&
              !producedOutputTool &&
              retryCount >= retryDeadline
            ) {
              const content = getToollessRecoveryContent(visibleAnswer);
              const toolCallId = `model-answer-recovery-${traceId}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: FINAL_ANSWER_TOOL,
                input: { content },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: { content },
              });
              return;
            }
            if (!requireViewOutput && !producedOutputTool && visibleAnswer) {
              const toolCallId = `model-answer-${traceId}`;
              writer.write({
                type: "tool-input-available",
                toolCallId,
                toolName: FINAL_ANSWER_TOOL,
                input: { content: visibleAnswer },
              });
              writer.write({
                type: "tool-output-available",
                toolCallId,
                output: { content: visibleAnswer },
              });
              return;
            }
            if (
              !shouldRetryToollessTurn({
                producedOutputTool,
                visibleAnswer,
                enforceToolOutput:
                  requireViewOutput ||
                  Object.prototype.hasOwnProperty.call(
                    allowlistedTools,
                    FINAL_ANSWER_TOOL,
                  ),
                retryCount,
                maxRetries: retryDeadline,
              })
            ) {
              return;
            }
            traceWarn(
              {
                traceId,
                retry: retryCount + 1,
                requireViewOutput,
                hadVisibleToollessText: visibleAnswer.length > 0,
                wroteTextualToolCall,
              },
              "kody-direct: turn ended without a required output tool (retrying)",
            );
            const completedAttemptMessages = (await attempt.response)?.messages;
            if (completedAttemptMessages?.length) {
              attemptMessages = trimToRecent([
                ...attemptMessages,
                ...completedAttemptMessages,
              ]);
            }
            attempt = runModelTurn(attemptMessages, [
              wroteTextualToolCall
                ? "Your previous message wrote a tool invocation as PLAIN TEXT. It did NOT execute. Re-issue the operation exactly once as a REAL API tool call. Do not claim any result from the plain-text invocation."
                : requireViewOutput
                  ? "Your previous attempt ended WITHOUT the required `show_view` tool call and produced no visible reply. Call `show_view` NOW with a valid spec for this interaction. Do not answer in prose."
                  : "Your previous attempt did not make a required API tool call. Plain text cannot read or change data. Re-evaluate the user's request, call the required operation tool first when an operation was requested, then finish with `final_answer`. For a conversational reply, call `final_answer` directly.",
            ]);
            writer.merge(
              attempt.toUIMessageStream({
                sendReasoning: true,
                onError: formatUIStreamError,
              }),
            );
          }
        } catch {
          // The primary stream already reported its own error state.
        }
      },
      onError: (error) => {
        clearHeartbeats();
        const msg = formatProviderError(error);
        traceError(
          { traceId, err: msg, ...extractProviderErrorMeta(error) },
          "kody-direct: ui-stream onError",
        );
        return formatUIStreamError(error);
      },
    });
    return createUIMessageStreamResponse({ stream: uiStream });
  } catch (err) {
    clearHeartbeats();
    clearGitHubContext();
    const msg = formatProviderError(err);
    traceError(
      { traceId, err: msg, ...extractProviderErrorMeta(err) },
      "kody-direct: stream failed",
    );
    return NextResponse.json({ error: msg, traceId }, { status: 500 });
  }
}
