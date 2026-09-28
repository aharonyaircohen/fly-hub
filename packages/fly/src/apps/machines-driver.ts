import type { FlyAppDriver } from "./lifecycle";
import {
  allocateSharedIps,
  cordonMachine,
  createApp,
  createMachine,
  destroyApp,
  destroyMachine,
  startMachine,
  stopMachine,
  uncordonMachine,
  waitForMachineStarted,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";

export interface FlyAppDriverOptions {
  config: FlyPreviewConfig;
  stageSecrets(appName: string, secrets: Record<string, string>): Promise<void>;
  healthCheck?(appName: string, machineId: string): Promise<void>;
}

export function createFlyAppDriver(options: FlyAppDriverOptions): FlyAppDriver {
  const cfg = options.config;
  return {
    ensureApp: (appName) => createApp(appName, cfg),
    stageSecrets: options.stageSecrets,
    allocateIngress: (appName) => allocateSharedIps(appName, cfg),
    async createMachine(input) {
      const machine = await createMachine(
        {
          appName: input.appName,
          image: input.imageRef,
          region: input.region,
          internalPort: input.internalPort,
          healthCheck: true,
          skipServiceRegistration: input.cordoned,
        },
        cfg,
      );
      return machine.id;
    },
    startMachine: (appName, machineId) => startMachine(appName, machineId, cfg),
    async waitHealthy(appName, machineId) {
      await waitForMachineStarted(appName, machineId, cfg);
      await options.healthCheck?.(appName, machineId);
    },
    cordonMachine: (appName, machineId) =>
      cordonMachine(appName, machineId, cfg),
    uncordonMachine: (appName, machineId) =>
      uncordonMachine(appName, machineId, cfg),
    stopMachine: (appName, machineId) => stopMachine(appName, machineId, cfg),
    destroyMachine: (appName, machineId) =>
      destroyMachine(appName, machineId, cfg),
    destroyApp: (appName) => destroyApp(appName, cfg),
  };
}
