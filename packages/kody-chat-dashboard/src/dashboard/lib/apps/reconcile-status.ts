type Machine = {
  state?: string;
  config?: { env?: Record<string, string> };
};

export type AppObservedStatus =
  | "provisioning"
  | "deploying"
  | "running"
  | "sleeping"
  | "stopped"
  | "unhealthy"
  | "failed"
  | "deleting"
  | "deleted";

export function visibleAppStatus(
  appStatus: AppObservedStatus,
  deploymentStatus?: string,
): AppObservedStatus | "verifying" {
  return deploymentStatus === "verifying" ? "verifying" : appStatus;
}

export function reconciledAppStatus(input: {
  current: AppObservedStatus;
  exposure: "private" | "public";
  machines: Machine[];
  builderState?: "building" | "failed";
}): AppObservedStatus {
  if (input.builderState === "building") return "deploying";
  const running = input.machines.filter(
    (machine) => machine.state === "started",
  );
  const runtimeReady = running.some(
    (machine) => !machine.config?.env?.KODY_APP_TOKEN_HASHES,
  );
  const gatewayReady = running.some((machine) =>
    Boolean(machine.config?.env?.KODY_APP_TOKEN_HASHES),
  );
  // Private runtimes live in a separate Fly app. The managed app name owns
  // only the authenticated gateway; deployment health has already proved the
  // gateway can reach its private Flycast runtime before reporting running.
  if (
    (input.exposure === "public" && runtimeReady) ||
    (input.exposure === "private" && gatewayReady)
  )
    return "running";
  if (input.current === "running") return "unhealthy";
  if (input.current === "provisioning" || input.current === "deploying")
    return "failed";
  return input.current;
}
