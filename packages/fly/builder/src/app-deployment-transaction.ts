/** Keep the working deployment intact until its replacement passes verification. */
export type DeploymentMachine = {
  app: string;
  id: string;
  state: string;
};
export type DeploymentVolume = { volumeId: string; mountPath: string };
export type DeploymentActions = {
  cordon(machine: DeploymentMachine): Promise<void>;
  stop(machine: DeploymentMachine): Promise<void>;
  resume(machine: DeploymentMachine): Promise<void>;
  destroy(machine: DeploymentMachine): Promise<void>;
  fork(volume: DeploymentVolume): Promise<DeploymentVolume>;
  destroyVolume(volume: DeploymentVolume): Promise<void>;
  applySecrets(): Promise<void>;
  restoreSecrets(): Promise<void>;
  verifyRecovery(): Promise<void>;
  deploy(
    volumes: DeploymentVolume[],
    register: (machine: DeploymentMachine) => void,
  ): Promise<void>;
  report(message: string): void;
};

export async function replaceAppDeployment(input: {
  previous: DeploymentMachine[];
  storage: DeploymentVolume[];
  previousVolumeIds: Set<string>;
  actions: DeploymentActions;
}) {
  const { previous, storage, previousVolumeIds, actions } = input;
  const paused: DeploymentMachine[] = [];
  const candidates: DeploymentMachine[] = [];
  const copies: DeploymentVolume[] = [];
  let secretsTouched = false;
  try {
    for (const machine of previous) {
      // Record before the request: a timed-out cordon/stop may have succeeded.
      paused.push(machine);
      await actions.cordon(machine);
      await actions.stop(machine);
    }
    const candidateStorage: DeploymentVolume[] = [];
    for (const volume of storage) {
      if (previousVolumeIds.has(volume.volumeId)) {
        const copy = await actions.fork(volume);
        copies.push(copy);
        candidateStorage.push(copy);
      } else candidateStorage.push(volume);
    }
    secretsTouched = true;
    await actions.applySecrets();
    await actions.deploy(candidateStorage, (machine) =>
      candidates.push(machine),
    );
  } catch (error) {
    const recoveryErrors: string[] = [];
    const recover = async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (failure) {
        recoveryErrors.push(
          `${label}: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
    };
    for (const machine of [...candidates].reverse())
      await recover(`remove replacement ${machine.id}`, () =>
        actions.destroy(machine),
      );
    for (const volume of copies)
      await recover(`remove copied volume ${volume.volumeId}`, () =>
        actions.destroyVolume(volume),
      );
    if (secretsTouched)
      await recover("restore previous secrets", () => actions.restoreSecrets());
    for (const machine of [...paused].reverse())
      await recover(`restart previous machine ${machine.id}`, () =>
        actions.resume(machine),
      );
    if (paused.length)
      await recover("check previous app", () => actions.verifyRecovery());
    if (recoveryErrors.length)
      throw new Error(
        `DEPLOYMENT_RECOVERY_FAILED: ${error instanceof Error ? error.message : String(error)}. Recovery needs attention: ${recoveryErrors.join("; ")}`,
        { cause: error },
      );
    actions.report(
      previous.length
        ? "Update failed. Previous machines, configuration, secrets, and data restored."
        : "Deployment failed. Replacement machines removed.",
    );
    throw error;
  }
  // Verification has passed. Retirement failures must never roll back a now
  // committed deployment, especially after some originals have been removed.
  for (const machine of previous) {
    try {
      await actions.destroy(machine);
    } catch (error) {
      actions.report(
        `App is verified; old machine ${machine.id} still needs cleanup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const volume of storage.filter((item) =>
    previousVolumeIds.has(item.volumeId),
  )) {
    try {
      await actions.destroyVolume(volume);
    } catch (error) {
      actions.report(
        `App is verified; old volume ${volume.volumeId} still needs cleanup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
