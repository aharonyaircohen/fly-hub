/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-server-commands
 *
 * Command boundary for Brain server lifecycle operations. Routes provide
 * authenticated context; this layer decides which Brain app/machine to mutate.
 */
import "server-only";
import { prepareBrainAgentFiles } from "./agent-files";
import { revokeAgentAccess } from "./agent-access";

import {
  destroyServerBrain,
  isServerBrainProvisionTransientError,
  provisionServerBrain,
  resumeServerBrain,
  suspendServerBrain,
  updateServerBrainSuspension,
  type ServerBrainPerfTier,
  type ProvisionServerBrainResult,
} from "@kody-ade/fly/infrastructure/server-brain";
import { ensureServerProviderTerminalBridge } from "@kody-ade/fly/infrastructure/server-terminal";

import { resolveBrainService } from "./service-resolver";
import { clearBrainRuntimeDeployment } from "./runtime-manager";
import { clearBrainApp, readBrainApp, writeBrainApp } from "./store";
import { resolveBrainTarget } from "./target";
import type { PersonalBrainContext } from "./personal-context";

export type BrainServerCommand =
  | "provision"
  | "resume"
  | "suspend"
  | "destroy"
  | "update-suspension"
  | "setup-terminal";

export interface ManageBrainServerInput {
  command: BrainServerCommand;
  context: PersonalBrainContext;
  dashboardUrl?: string;
  appNameOverride?: string;
  perfTier?: ServerBrainPerfTier;
  suspendOnIdle?: boolean;
  replaceExistingMachine?: boolean;
}

export class BrainCommandError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "brain_command_failed",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function requireFlyToken(context: PersonalBrainContext): string {
  if (!context.flyToken) {
    throw new BrainCommandError(
      "Fly token missing - add FLY_API_TOKEN to Personal Credentials.",
      400,
      "fly_token_missing",
    );
  }
  return context.flyToken;
}

async function resolveCurrentBrain(
  context: PersonalBrainContext,
  appNameOverride?: string,
) {
  return resolveBrainService({
    flyToken: requireFlyToken(context),
    account: context.account,
    githubToken: context.githubToken,
    orgSlug: context.flyOrgSlug,
    defaultRegion: context.flyDefaultRegion,
    ...(appNameOverride ? { appNameOverride } : {}),
  });
}

async function provisionManagedBrain(
  input: ManageBrainServerInput,
  options: { replaceExistingMachine?: boolean } = {},
): Promise<ProvisionServerBrainResult> {
  const { context } = input;
  const flyToken = requireFlyToken(context);
  const stored = await readBrainApp(context.account, context.githubToken).catch(
    () => null,
  );
  const target = resolveBrainTarget({
    account: context.account,
    contextOrgSlug: context.flyOrgSlug,
    stored,
    appNameOverride: input.appNameOverride,
  });
  try {
    const result = await provisionServerBrain({
      ...(input.dashboardUrl
        ? {
            prepareAgentFiles: (app: string) =>
              prepareBrainAgentFiles(app, input.dashboardUrl!),
          }
        : {}),
      providerToken: flyToken,
      account: context.account,
      model: context.engineModel,
      modelConfig: context.engineModelConfig,
      githubToken: context.githubToken,
      allSecrets: context.allSecrets,
      perfTier: input.perfTier ?? context.perfTier,
      orgSlug: target.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      suspendOnIdle: input.suspendOnIdle,
      dashboardUrl: input.dashboardUrl,
      appNameOverride: target.app,
      ...(options.replaceExistingMachine
        ? { replaceExistingMachine: true }
        : {}),
    });
    await writeBrainApp(context.account, context.githubToken, {
      version: 1,
      appName: result.app,
      orgSlug: result.org,
      createdAt: new Date().toISOString(),
    });
    return result;
  } catch (err) {
    if (isServerBrainProvisionTransientError(err)) {
      const retryable = err as Error & { retryAfterSeconds?: number };
      throw new BrainCommandError(
        retryable.message,
        503,
        "brain_provision_retryable",
        retryable.retryAfterSeconds,
      );
    }
    throw err;
  }
}

export function manageBrainServer(
  input: ManageBrainServerInput & { command: "provision" },
): Promise<ProvisionServerBrainResult>;
export function manageBrainServer(
  input: ManageBrainServerInput & {
    command: "resume" | "suspend" | "destroy";
  },
): Promise<{ ok: true }>;
export function manageBrainServer(
  input: ManageBrainServerInput & { command: "update-suspension" },
): Promise<{ ok: true; suspendOnIdle: boolean }>;
export function manageBrainServer(
  input: ManageBrainServerInput & { command: "setup-terminal" },
): Promise<{
  ok: true;
  app: string;
  machineId: string;
  bridgeApp: string;
}>;

export async function manageBrainServer(input: ManageBrainServerInput) {
  const { context } = input;
  const flyToken = requireFlyToken(context);

  if (input.command === "provision") {
    return provisionManagedBrain(input);
  }

  if (input.command === "setup-terminal") {
    if (!input.replaceExistingMachine) {
      const brain = await resolveCurrentBrain(context, input.appNameOverride);
      if (!brain.machineId) {
        throw new BrainCommandError(
          "Brain machine not found.",
          404,
          "machine_not_found",
        );
      }
      const bridge = await ensureServerProviderTerminalBridge({
        token: brain.flyToken,
        orgSlug: brain.orgSlug,
        defaultRegion: context.flyDefaultRegion,
      });
      return {
        ok: true,
        app: brain.app,
        machineId: brain.machineId,
        bridgeApp: bridge.app,
      };
    }
    const result = await provisionManagedBrain(input, {
      replaceExistingMachine: true,
    });
    const bridge = await ensureServerProviderTerminalBridge({
      token: flyToken,
      orgSlug: result.org,
      defaultRegion: context.flyDefaultRegion,
    });
    return {
      ok: true,
      app: result.app,
      machineId: result.machineId,
      bridgeApp: bridge.app,
    };
  }

  const brain = await resolveCurrentBrain(context, input.appNameOverride);

  if (input.command === "resume") {
    await resumeServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
      ...(brain.machineId ? { machineIdOverride: brain.machineId } : {}),
    });
    return { ok: true };
  }

  if (input.command === "suspend") {
    await suspendServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
      ...(brain.machineId ? { machineIdOverride: brain.machineId } : {}),
    });
    return { ok: true };
  }

  if (input.command === "destroy") {
    await destroyServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
    });
    const destroyedStoredBrain =
      !input.appNameOverride || brain.stored?.appName === brain.app;
    if (destroyedStoredBrain) {
      await revokeAgentAccess(context.userId);
      await clearBrainRuntimeDeployment(context.account, context.githubToken);
      await clearBrainApp(context.account, context.githubToken);
    }
    return { ok: true };
  }

  if (input.command === "update-suspension") {
    if (input.suspendOnIdle === undefined) {
      throw new BrainCommandError(
        "Brain suspension must be 'auto' or 'never'.",
        400,
        "invalid_brain_suspension",
      );
    }
    if (brain.state === "off" || !brain.machineId) {
      throw new BrainCommandError(
        "Brain is not on yet. Turn it on before changing suspension.",
        409,
        "brain_not_running",
      );
    }
    return {
      ok: true,
      ...(await updateServerBrainSuspension({
        providerToken: brain.flyToken,
        account: context.account,
        orgSlug: brain.orgSlug,
        defaultRegion: context.flyDefaultRegion,
        appNameOverride: brain.app,
        machineIdOverride: brain.machineId,
        suspendOnIdle: input.suspendOnIdle,
      })),
    };
  }

  throw new BrainCommandError("Unsupported Brain command.", 400);
}
