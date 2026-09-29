export type AppRunStage =
  | "inspecting"
  | "needs_input"
  | "building"
  | "retrying"
  | "starting"
  | "sleeping"
  | "ready"
  | "build_failed"
  | "eve_failed"
  | "eve_unavailable"
  | "finished_without_app"
  | "cancelled";

export type FlyMachineEvent = {
  type: string;
  status: string;
  source: string;
  timestamp: number;
  exitCode?: number;
  oomKilled?: boolean;
  requestedStop?: boolean;
};

export function machineEventReason(event?: FlyMachineEvent): string | null {
  if (!event) return null;
  if (event.type === "suspension" && event.source === "proxy")
    return "Fly paused this idle machine. It can wake when requested.";
  if (event.type === "exit") {
    if (event.oomKilled) return "The machine ran out of memory.";
    if (event.exitCode === 0) return "The machine's process finished successfully.";
    if (typeof event.exitCode === "number") return `The machine's process exited with code ${event.exitCode}.`;
  }
  return `${event.type} (${event.status}) by ${event.source}.`;
}

export function appRunStage(input: {
  eveStatus: string;
  builderState?: "building" | "failed" | null;
  gatewayState?: string | null;
  runtimeState?: string | null;
  eveError?: string | null;
  ready: boolean;
}): { stage: AppRunStage; explanation: string } {
  if (input.ready && input.builderState === "failed")
    return { stage: "build_failed", explanation: "The latest build failed. A previously deployed app is still responding." };
  if (input.ready && input.eveStatus === "failed")
    return { stage: "eve_failed", explanation: "Eve stopped, but a previously deployed app is still responding. The new run did not complete." };
  if (input.ready)
    return { stage: "ready", explanation: "The app is responding and its password gate is ready." };
  if (input.gatewayState === "suspended")
    return { stage: "sleeping", explanation: "Fly suspended the idle app machine. Opening the app should wake it." };
  if (input.gatewayState || input.runtimeState)
    return {
      stage: "starting",
      explanation: "Fly created app machines, but the app has not passed its health check yet.",
    };
  if (input.builderState === "building")
    return { stage: "building", explanation: "A temporary Fly builder machine is building the app." };
  if (input.builderState === "failed")
    return input.eveStatus === "working"
      ? { stage: "retrying", explanation: "The Fly build failed. Eve is inspecting the error and may retry." }
      : { stage: "build_failed", explanation: "The Fly build failed before an app machine was created." };
  if (input.eveStatus === "failed")
    return /GatewayRateLimitError|rate limit exceeded/i.test(input.eveError ?? "")
      ? {
          stage: "eve_failed",
          explanation: "Eve's model hit its rate limit before deployment. No Fly app machine was created. Retry after the limit clears or choose another Builder model in Eve Studio.",
        }
      : { stage: "eve_failed", explanation: "Eve stopped before a Fly app machine was created. The error is shown below." };
  if (input.eveStatus === "unavailable")
    return { stage: "eve_unavailable", explanation: "Fly Hub could not read Eve's current status. Fly machine states are shown below; refresh to try again." };
  if (input.eveStatus === "cancelled")
    return { stage: "cancelled", explanation: "This Eve run was cancelled. No Fly app machine was created." };
  if (input.eveStatus === "input_required" || input.eveStatus === "authorization_required")
    return { stage: "needs_input", explanation: "Eve needs an answer before it can continue." };
  if (input.eveStatus === "completed")
    return { stage: "finished_without_app", explanation: "Eve finished without creating a Fly app machine. Read its result below." };
  return { stage: "inspecting", explanation: "Eve is inspecting the repository. No Fly app machine exists yet." };
}

export function runtimeAppName(gatewayAppName: string): string {
  const suffix = gatewayAppName.slice(-8);
  const prefix = gatewayAppName.slice(0, 51).replace(/-+$/, "");
  return `${prefix}-rt-${suffix}`.slice(0, 63);
}
