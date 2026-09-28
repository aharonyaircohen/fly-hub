/**
 * @fileType service
 * @domain brain
 * @pattern brain-service-resolver
 *
 * Server-side source of truth for the user's Brain service. It combines the
 * dashboard's stored Brain record with Fly's live machine state.
 */
import "server-only";

import { readBrainRuntimeView } from "./runtime-manager";
import { readBrainApp, type BrainAppFile } from "./store";
import { resolveBrainTarget } from "./target";
import { listServerProviderMachines } from "@kody-ade/fly/infrastructure/server-machines";
import {
  serverBrainStatus,
  type ServerBrainStatusResult,
} from "@kody-ade/fly/infrastructure/server-brain";
import {
  isServerProviderMachineRunning,
  rowsForServerProviderApp,
  type ServerProviderMachineRow,
} from "@kody-ade/fly/infrastructure/server-machines";

export type BrainServiceReason =
  | "not_provisioned"
  | "stored_app_not_found"
  | "app_has_no_machine"
  | "runtime_machine_not_found"
  | "machine_lookup_failed"
  | "fly_access_denied";

export interface ServerBrainServiceResolution {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  flyToken: string;
  stored: BrainAppFile | null;
  state: ServerBrainStatusResult["state"];
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  machine?: ServerProviderMachineRow;
  reason?: BrainServiceReason;
}

export type BrainServiceResolution = ServerBrainServiceResolution;

function flyAccessDenied(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Fly Machines API (401|403)|unauthorized|forbidden/i.test(message);
}

export async function resolveBrainService(input: {
  flyToken: string;
  account: string;
  githubToken: string;
  orgSlug: string;
  defaultRegion: string;
  appNameOverride?: string;
  machineIdOverride?: string;
}): Promise<ServerBrainServiceResolution> {
  const stored = await readBrainApp(input.account, input.githubToken).catch(
    () => null,
  );
  const runtime = await readBrainRuntimeView(
    input.account,
    input.githubToken,
  ).catch(() => null);
  const target = resolveBrainTarget({
    account: input.account,
    contextOrgSlug: input.orgSlug,
    stored,
    appNameOverride: input.appNameOverride,
  });
  const recordedRunningApp =
    !input.appNameOverride && target.source === "default"
      ? runtime?.runningApp
      : undefined;
  const app = input.appNameOverride ?? recordedRunningApp ?? target.app;
  const orgSlug =
    runtime?.runningApp === app && runtime.runningOrgSlug
      ? runtime.runningOrgSlug
      : target.orgSlug;
  const runtimeMachineId =
    runtime?.runningApp === app ? runtime.runningMachineId : undefined;
  const targetMachineId = input.machineIdOverride ?? runtimeMachineId;

  const resolveWithToken = async (
    flyToken: string,
  ): Promise<ServerBrainServiceResolution> => {
    const status = await serverBrainStatus({
      flyToken,
      account: input.account,
      appNameOverride: app,
      machineIdOverride: targetMachineId,
      orgSlug,
      defaultRegion: input.defaultRegion,
    });

    let machine: ServerProviderMachineRow | undefined;
    let machineLookupFailed = false;
    let machineAccessDenied = Boolean(status.accessDenied);
    try {
      const machines = await listServerProviderMachines(app, {
        token: flyToken,
        orgSlug,
        defaultRegion: input.defaultRegion,
      });
      const rows = rowsForServerProviderApp(app, machines, Date.now(), {
        feature: "brain",
        label: app,
        orgSlug,
      });
      machine = rows.find((row) =>
        targetMachineId ? row.machineId === targetMachineId : true,
      );
      if (!machine && targetMachineId) {
        const runningMachines = rows.filter((row) =>
          isServerProviderMachineRunning(row.state),
        );
        // Setup can replace the recorded machine. A sole replacement is
        // authoritative even while stopped; callers must be able to wake it.
        if (rows.length === 1) {
          machine = rows[0];
        } else if (runningMachines.length === 1) {
          machine = runningMachines[0];
        }
      }
    } catch (err) {
      machineLookupFailed = true;
      machineAccessDenied = machineAccessDenied || flyAccessDenied(err);
    }

    const resolvedState = machine
      ? isServerProviderMachineRunning(machine.state)
        ? "running"
        : machine.state === "suspended"
          ? "suspended"
          : machine.state === "stopped"
            ? "stopped"
            : status.state
      : status.state;
    const reason: BrainServiceReason | undefined = machineAccessDenied
      ? "fly_access_denied"
      : targetMachineId && !machine && !machineLookupFailed
        ? "runtime_machine_not_found"
        : machineLookupFailed && resolvedState !== "off"
          ? "machine_lookup_failed"
          : resolvedState !== "off"
            ? undefined
            : stored
              ? status.url
                ? "app_has_no_machine"
                : "stored_app_not_found"
              : "not_provisioned";

    return {
      app: status.app,
      orgSlug: status.org ?? orgSlug,
      defaultRegion: input.defaultRegion,
      flyToken,
      stored,
      state: resolvedState,
      url: status.url,
      machineId: machine?.machineId ?? targetMachineId ?? status.machineId,
      machineImageRef: machine?.imageRef ?? status.machineImageRef,
      machine,
      reason,
    };
  };

  return resolveWithToken(input.flyToken);
}
