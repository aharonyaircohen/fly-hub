export interface FlyAppDriver {
  ensureApp(appName: string): Promise<void>;
  stageSecrets(appName: string, secrets: Record<string, string>): Promise<void>;
  allocateIngress(appName: string): Promise<void>;
  createMachine(input: {
    appName: string;
    imageRef: string;
    region: string;
    internalPort: number;
    cordoned: boolean;
  }): Promise<string>;
  startMachine(appName: string, machineId: string): Promise<void>;
  waitHealthy(appName: string, machineId: string): Promise<void>;
  cordonMachine(appName: string, machineId: string): Promise<void>;
  uncordonMachine(appName: string, machineId: string): Promise<void>;
  stopMachine(appName: string, machineId: string): Promise<void>;
  destroyMachine(appName: string, machineId: string): Promise<void>;
  destroyApp(appName: string): Promise<void>;
}

export interface DeployFlyAppInput {
  appName: string;
  imageRef: string;
  region: string;
  internalPort: number;
  exposure: "private" | "public";
  secrets: Record<string, string>;
  previousMachineId?: string;
}

export async function deployFlyApp(
  driver: FlyAppDriver,
  input: DeployFlyAppInput,
): Promise<{ machineId: string }> {
  await driver.ensureApp(input.appName);
  await driver.stageSecrets(input.appName, input.secrets);
  // Private Apps are internet-reachable for consumer sites, but their bundled
  // doorman enforces an App token. Exposure controls authentication, not IPs.
  await driver.allocateIngress(input.appName);
  const machineId = await driver.createMachine({
    appName: input.appName,
    imageRef: input.imageRef,
    region: input.region,
    internalPort: input.internalPort,
    cordoned: true,
  });
  try {
    await driver.startMachine(input.appName, machineId);
    await driver.waitHealthy(input.appName, machineId);
    await driver.uncordonMachine(input.appName, machineId);
  } catch (error) {
    await driver
      .destroyMachine(input.appName, machineId)
      .catch(() => undefined);
    throw error;
  }
  if (input.previousMachineId && input.previousMachineId !== machineId) {
    await driver.cordonMachine(input.appName, input.previousMachineId);
    await driver.stopMachine(input.appName, input.previousMachineId);
    await driver.destroyMachine(input.appName, input.previousMachineId);
  }
  return { machineId };
}

export async function manageFlyApp(
  driver: FlyAppDriver,
  input: {
    action: "start" | "stop" | "restart" | "delete";
    appName: string;
    machineId?: string;
  },
): Promise<void> {
  if (input.action === "delete") return driver.destroyApp(input.appName);
  if (!input.machineId) throw new Error("APP_MACHINE_REQUIRED");
  if (input.action === "start")
    return driver.startMachine(input.appName, input.machineId);
  if (input.action === "stop")
    return driver.stopMachine(input.appName, input.machineId);
  await driver.stopMachine(input.appName, input.machineId);
  await driver.startMachine(input.appName, input.machineId);
  await driver.waitHealthy(input.appName, input.machineId);
}
