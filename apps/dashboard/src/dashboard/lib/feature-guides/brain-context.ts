/**
 * @fileType adapter
 * @domain features
 * @pattern brain-feature-guide-context
 * @ai-summary Resolves one Dashboard-owned guide for a Brain turn and frames
 *   it as authoritative context before the original user message.
 */
import "server-only";

import { formatFeatureGuidePromptSection } from "@kody-ade/kody-chat-dashboard/platform/feature-guide-context";

import { dashboardFeatureGuideProvider } from "./provider";

export async function withDashboardFeatureGuideContext(input: {
  message: string;
  currentPage?: string | null;
}): Promise<string> {
  const guide = await dashboardFeatureGuideProvider.resolveForTurn({
    currentPage: input.currentPage,
    userText: input.message,
  });
  if (!guide) return input.message;

  return `${formatFeatureGuidePromptSection(guide)}\n\n## Current user request\n\n${input.message}`;
}
