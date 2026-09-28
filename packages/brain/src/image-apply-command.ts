/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-image-apply-command
 *
 * Command boundary for restoring/applying a saved Brain image.
 */
import "server-only";

import type { PersonalBrainContext } from "./personal-context";

import {
  applyBrainImageToRuntime,
  type ApplyBrainImageResult,
} from "./image-apply";

export interface ApplyBrainImageCommandInput {
  context: PersonalBrainContext;
  dashboardUrl: string;
  imageRef?: string;
  reset?: boolean;
  operationId?: string;
}

export async function applyBrainImage(
  input: ApplyBrainImageCommandInput,
): Promise<ApplyBrainImageResult> {
  const { context } = input;
  if (!context.githubAccount) {
    throw new Error(
      "Reconnect your GitHub account so Kody can identify the saved image registry.",
    );
  }
  if (!context.flyToken) {
    throw new Error(
      "Brain image apply needs a Fly token. Add FLY_API_TOKEN to Personal Credentials.",
    );
  }
  return applyBrainImageToRuntime({
    owner: context.githubOwner ?? context.githubAccount ?? context.account,
    repo: "personal-brain",
    account: context.account,
    githubAccount: context.githubAccount,
    githubToken: context.githubToken,
    allSecrets: context.allSecrets,
    flyToken: context.flyToken,
    flyOrgSlug: context.flyOrgSlug,
    flyDefaultRegion: context.flyDefaultRegion,
    dashboardUrl: input.dashboardUrl,
    engineModel: context.engineModel,
    engineModelConfig: context.engineModelConfig,
    perfTier: context.perfTier,
    imageRef: input.imageRef,
    resetExistingMachine: input.reset === true,
    operationId: input.operationId,
  });
}
