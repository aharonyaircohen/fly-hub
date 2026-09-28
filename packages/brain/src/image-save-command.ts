/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-image-save-command
 *
 * Command boundary for saving the current live Brain server as a GHCR image.
 */
import "server-only";
import {
  beginBrainRuntimeApply,
  finishBrainImageSaveOperation,
} from "./runtime-manager";

import { startTerminalBridgeLocalExecJob } from "@kody-ade/terminal/bridge-exec-client";
import { ensureServerProviderTerminalBridge } from "@kody-ade/fly/infrastructure/server-terminal";
import { mintTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";
import {
  defaultServerBrainImage,
  waitForServerBrainHealth,
} from "@kody-ade/fly/infrastructure/server-brain";
import type { PersonalBrainContext } from "./personal-context";

import {
  brainGhcrImageRef,
  brainImageBuildCommand,
  brainImageTag,
} from "./image-save";
import { brainImageJobTimeoutMs } from "./image-timeouts";
import { brainGhcrAuth } from "./image-runtime";
import { resolveBrainService } from "./service-resolver";
import { writeBrainImageSave, type BrainImageSaveFile } from "./store";

const BRAIN_IMAGE_JOB_OUTPUT_BYTES = 2_000_000;
const FLY_BRIDGE_ACCESS_DENIED_MESSAGE =
  "Fly token cannot create or access the terminal bridge app needed to save Brain image.";

export interface StartBrainImageSaveInput {
  context: PersonalBrainContext;
}

function flyAccessDenied(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Fly Machines API (401|403)|unauthorized|forbidden/i.test(message);
}

function bridgeAccessDeniedError(input: {
  app: string;
  org: string;
  cause: unknown;
}): Error & {
  status?: number;
  code?: string;
  app?: string;
  org?: string;
  cause?: unknown;
} {
  const error = new Error(FLY_BRIDGE_ACCESS_DENIED_MESSAGE) as Error & {
    status?: number;
    code?: string;
    app?: string;
    org?: string;
    cause?: unknown;
  };
  error.status = 403;
  error.code = "fly_bridge_access_denied";
  error.app = input.app;
  error.org = input.org;
  error.cause = input.cause;
  return error;
}

export async function startBrainImageSave(input: StartBrainImageSaveInput) {
  const { context } = input;
  if (!context.flyToken) {
    throw new Error(
      "Brain image save needs a Fly Machines token. Add FLY_API_TOKEN to the repo Secrets vault.",
    );
  }

  const ghcr = brainGhcrAuth({
    allSecrets: context.allSecrets,
    githubToken: context.githubToken,
    account: context.githubAccount ?? context.account,
  });
  if (!ghcr.token.trim()) {
    throw Object.assign(
      new Error(
        "Connect your GitHub account with a classic PAT that has write:packages permission to save a Brain image.",
      ),
      { status: 400 },
    );
  }
  if (!context.githubAccount) {
    throw Object.assign(
      new Error(
        "Reconnect your GitHub account so Kody can identify where to save the Brain image.",
      ),
      { status: 400 },
    );
  }

  const now = new Date();
  const tag = brainImageTag(now);
  const expectedImageRef = brainGhcrImageRef({
    owner: context.githubOwner ?? ghcr.user,
    account: context.githubAccount ?? ghcr.user,
    tag,
  });
  const operation = await beginBrainRuntimeApply(
    context.account,
    context.githubToken,
    expectedImageRef,
    "save-image",
  );
  const operationId = operation.operation!.id;
  let dispatchAttempted = false;
  try {
    const brain = await resolveBrainService({
      flyToken: context.flyToken,
      account: context.account,
      githubToken: context.githubToken,
      orgSlug: context.flyOrgSlug,
      defaultRegion: context.flyDefaultRegion,
    });
    const app = brain.app;
    const machineId = brain.machineId;
    const brainFlyToken = brain.flyToken;
    if (brain.reason === "fly_access_denied") {
      const error = new Error(
        "Fly token cannot access this Brain app.",
      ) as Error & {
        status?: number;
        code?: string;
        app?: string;
        org?: string;
      };
      error.status = 403;
      error.code = "fly_access_denied";
      error.app = brain.app;
      error.org = brain.orgSlug;
      throw error;
    }
    if (brain.state === "off" || !machineId || !brain.url) {
      const error = new Error("No Brain machine found to save.") as Error & {
        status?: number;
        code?: string;
        reason?: string;
      };
      error.status = 404;
      error.code = "brain_not_found";
      error.reason = brain.reason;
      throw error;
    }
    await waitForServerBrainHealth(brain.url, 120_000);

    const bridge = await ensureServerProviderTerminalBridge({
      token: brainFlyToken,
      orgSlug: brain.orgSlug,
      defaultRegion: brain.defaultRegion,
    }).catch((err) => {
      if (flyAccessDenied(err)) {
        throw bridgeAccessDeniedError({
          app,
          org: brain.orgSlug,
          cause: err,
        });
      }
      throw err;
    });
    const token = mintTerminalBridgeToken({
      owner: context.account,
      repo: "personal-brain",
      app,
      orgSlug: brain.orgSlug,
      machineId,
      flyToken: brainFlyToken,
      ghcrToken: ghcr.token,
      localExec: true,
      ttlSeconds: 900,
      secret: bridge.secret,
    });
    const save: BrainImageSaveFile = {
      authorizationOwner: context.account,
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
      jobId: operationId,
      app,
      machineId,
      bridgeApp: bridge.app,
      orgSlug: brain.orgSlug,
      defaultRegion: brain.defaultRegion,
      expectedImageRef,
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await writeBrainImageSave(context.account, context.githubToken, save);
    const command = brainImageBuildCommand({
      app,
      machineId,
      orgSlug: brain.orgSlug,
      tag,
      baseImageRef: defaultServerBrainImage,
      imageRef: expectedImageRef,
      ghcrUser: ghcr.user,
    });
    dispatchAttempted = true;
    await startTerminalBridgeLocalExecJob({
      jobId: operationId,
      bridgeUrl: bridge.url,
      token,
      command,
      timeoutMs: brainImageJobTimeoutMs(),
      maxOutputBytes: BRAIN_IMAGE_JOB_OUTPUT_BYTES,
    });

    return {
      ok: true,
      status: "running" as const,
      phase: "starting" as const,
      message: "Starting Brain image save",
      jobId: operationId,
      app,
      machineId,
      imageRef: expectedImageRef,
      startedAt: save.startedAt,
    };
  } catch (error) {
    if (!dispatchAttempted) {
      await finishBrainImageSaveOperation(
        context.account,
        context.githubToken,
        operationId,
        error instanceof Error ? error.message : "Save could not start",
      );
    }
    throw error;
  }
}
