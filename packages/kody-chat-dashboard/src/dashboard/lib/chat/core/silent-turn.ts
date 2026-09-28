/**
 * User-visible fallback for assistant turns that finish with reasoning but no
 * answer or rendered view.
 */
export const SILENT_ASSISTANT_NOTICE =
  "Kody returned no response. The model may not be configured for this repo, or it ended the turn without a reply — try again, or check Chat Models in Settings.";

export const TRANSIENT_ASSISTANT_NOTICE =
  "The assistant did not return a final result. The action may have completed; verify it before retrying.";

export const MODEL_OPERATION_FAILURE_NOTICE =
  "This model could not complete the requested operation with the available tools. Choose another model and try again.";

export const MODEL_CONFIGURATION_NOTICE =
  "This chat model is not configured. Add its API key under Settings → Secrets, or choose another model.";

export const OPENROUTER_PROVIDER_POLICY_NOTICE =
  "OpenRouter blocked this free model because your account only allows selected providers. Update the allowed providers in OpenRouter Privacy settings, then try again. https://openrouter.ai/settings/privacy";

const TOOL_PROTOCOL_FAILURE_PATTERNS = [
  /(?:(?:does not|doesn't) support|unsupported).{0,40}(?:tools?|functions?)/i,
  /no endpoints? found that support.{0,20}(?:tools?|functions?)/i,
  /(?:tools?|functions?).{0,50}(?:not supported|unsupported|not (?:defined|found|available)|unknown|invalid)/i,
  /(?:unknown|invalid|undefined|undeclared|unavailable|no such).{0,20}(?:tools?|functions?)/i,
];

const TRACE_PREFIX = /^\[trace ([^\]]+)]\s*/i;
const TRACE_SUFFIX = /\(trace ([^)]+)\)\s*$/i;

export function normalizeModelOperationFailure(message: string): string {
  if (/model_api_key_missing/i.test(message)) {
    const traceId =
      TRACE_PREFIX.exec(message)?.[1] ?? TRACE_SUFFIX.exec(message)?.[1];
    return traceId
      ? `${MODEL_CONFIGURATION_NOTICE} (trace ${traceId})`
      : MODEL_CONFIGURATION_NOTICE;
  }

  const isOpenRouterProviderPolicyFailure =
    /no allowed providers are available for the selected model/i.test(
      message,
    ) && /allowed-providers?\s+setting/i.test(message);
  if (isOpenRouterProviderPolicyFailure) {
    const traceId =
      TRACE_PREFIX.exec(message)?.[1] ?? TRACE_SUFFIX.exec(message)?.[1];
    return traceId
      ? `${OPENROUTER_PROVIDER_POLICY_NOTICE} (trace ${traceId})`
      : OPENROUTER_PROVIDER_POLICY_NOTICE;
  }

  const isToolProtocolFailure = TOOL_PROTOCOL_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
  if (!isToolProtocolFailure) return message;
  const traceId =
    TRACE_PREFIX.exec(message)?.[1] ?? TRACE_SUFFIX.exec(message)?.[1];
  return traceId
    ? `${MODEL_OPERATION_FAILURE_NOTICE} (trace ${traceId})`
    : MODEL_OPERATION_FAILURE_NOTICE;
}

export function getIncompleteAssistantNotice(input: {
  hasToolActivity: boolean;
  hasTransientStatus: boolean;
}): string {
  if (input.hasTransientStatus) return TRANSIENT_ASSISTANT_NOTICE;
  return input.hasToolActivity
    ? MODEL_OPERATION_FAILURE_NOTICE
    : SILENT_ASSISTANT_NOTICE;
}

const TRANSIENT_ASSISTANT_STATUS =
  /^(registering|starting|working|processing|checking|trying|loading|running)\b/i;

export function isLikelyTransientAssistantStatus(answer: string): boolean {
  const normalized = answer.trim().replace(/\s+/g, " ");
  return (
    normalized.length > 0 &&
    normalized.length <= 120 &&
    TRANSIENT_ASSISTANT_STATUS.test(normalized)
  );
}
