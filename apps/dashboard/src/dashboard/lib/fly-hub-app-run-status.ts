export type AppRunStage =
  | "inspecting"
  | "needs_input"
  | "building"
  | "retrying"
  | "starting"
  | "sleeping"
  | "ready"
  | "app_failed"
  | "app_stopped"
  | "build_failed"
  | "eve_failed"
  | "eve_unavailable"
  | "finished_without_app"
  | "cancelled"
  | "cancelling";

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
    if (event.exitCode === 0)
      return "The machine's process finished successfully.";
    if (typeof event.exitCode === "number")
      return `The machine's process exited with code ${event.exitCode}.`;
  }
  return `${event.type} (${event.status}) by ${event.source}.`;
}

export function appRunStage(input: {
  eveStatus: string;
  builderState?: "building" | "completed" | "failed" | "cancelling" | "cancelled" | null;
  gatewayState?: string | null;
  runtimeState?: string | null;
  eveError?: string | null;
  ready: boolean;
}): { stage: AppRunStage; explanation: string } {
  if (input.builderState === "cancelling" || (input.builderState === "building" && input.eveStatus === "cancelled")) return { stage: "cancelling", explanation: "Stopping setup and cleaning up. A previous deployment will be restored if it was paused." };
  if (input.builderState === "cancelled") return { stage: "cancelled", explanation: "Setup cancelled. Check cleanup details below to confirm the previous app was kept and replacement resources were removed." };
  if (input.builderState === "failed")
    return input.eveStatus === "working"
      ? {
          stage: "retrying",
          explanation:
            "The Fly build failed. Eve is inspecting the error and may retry.",
        }
      : {
          stage: "build_failed",
          explanation: input.ready
            ? "The latest build failed. A previously deployed app is still responding."
            : "The Fly build failed. Read the build error and machine details below.",
        };
  if (input.eveStatus === "failed")
    return input.ready
      ? {
          stage: "eve_failed",
          explanation:
            "Eve stopped, but a previously deployed app is still responding. The new run did not complete.",
        }
      : /GatewayRateLimitError|rate limit exceeded/i.test(input.eveError ?? "")
        ? {
            stage: "eve_failed",
            explanation:
              "Eve's model hit its rate limit. Read the machine details below to see whether deployment started. Retry after the limit clears or choose another Builder model in Eve Studio.",
          }
        : {
            stage: "eve_failed",
            explanation:
              "Eve stopped. Read its error and the machine details below.",
          };
  if (input.eveStatus === "cancelled")
    return {
      stage: "cancelled",
      explanation:
        "Setup cancelled. Further deployment requests from this run are blocked. A deployment that already finished is kept.",
    };
  if (input.builderState === "building")
    return {
      stage: "building",
      explanation:
        "A temporary Fly builder machine is building and checking the app.",
    };
  if (
    input.gatewayState === "failed" ||
    input.runtimeState === "failed" ||
    input.gatewayState === "destroyed" ||
    input.runtimeState === "destroyed"
  )
    return {
      stage: "app_failed",
      explanation:
        "An app machine failed or was removed. Read the machine details below.",
    };
  if (input.ready)
    return {
      stage: "ready",
      explanation:
        "This deployment is responding and its password gate is ready.",
    };
  if (input.gatewayState === "suspended" || input.runtimeState === "suspended")
    return {
      stage: "sleeping",
      explanation:
        "Fly suspended an idle app machine. Opening the app should wake it.",
    };
  if (input.gatewayState === "stopped" || input.runtimeState === "stopped")
    return {
      stage: "app_stopped",
      explanation:
        "An app machine is stopped. Read its last event below to see why.",
    };
  if (input.builderState === "completed")
    return {
      stage: "starting",
      explanation:
        "The build finished. Fly is starting the app machines and checking their health.",
    };
  if (input.eveStatus === "unavailable")
    return {
      stage: "eve_unavailable",
      explanation:
        "Fly Hub could not read Eve's current status. Fly machine states are shown below; refresh to try again.",
    };
  if (
    input.eveStatus === "input_required" ||
    input.eveStatus === "authorization_required"
  )
    return {
      stage: "needs_input",
      explanation: "Eve needs an answer before it can continue.",
    };
  if (input.eveStatus === "completed")
    return {
      stage: "finished_without_app",
      explanation:
        "This run finished without a verified deployment. Read its result and machine details below.",
    };
  return {
    stage: "inspecting",
    explanation:
      input.gatewayState || input.runtimeState
        ? "Eve is preparing a new deployment. The machines below may belong to the previous deployment."
        : "Eve is inspecting the repository. No Fly app machine exists yet.",
  };
}

export function runtimeAppName(gatewayAppName: string): string {
  const suffix = gatewayAppName.slice(-8);
  const prefix = gatewayAppName.slice(0, 51).replace(/-+$/, "");
  return `${prefix}-rt-${suffix}`.slice(0, 63);
}

export function deployedAppState(
  gatewayState: string,
  runtimeStates: string[],
): string {
  const states = [gatewayState, ...runtimeStates];
  if (states.some((state) => state === "failed" || state === "destroyed"))
    return "failed";
  if (!runtimeStates.length) return "unavailable";
  if (states.includes("stopped")) return "stopped";
  if (states.includes("suspended")) return "suspended";
  return states.every((state) => state === "started") ? "started" : "starting";
}
