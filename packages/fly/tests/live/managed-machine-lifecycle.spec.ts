import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import tls from "node:tls";
import { expect, it } from "vitest";

import { createManagedMachine, managedMachineAppName } from "../../src/machines/managed";
import {
  appExists,
  destroyApp,
  destroyMachine,
  listMachines,
  startMachine,
  stopMachine,
  suspendMachine,
  type FlyPreviewConfig,
} from "../../src/plugin/previews/machines-client";
import { sshPorts } from "../../src/ssh/machine-config";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function machineState(app: string, id: string, cfg: FlyPreviewConfig) {
  return (await listMachines(app, cfg)).find((machine) => machine.id === id)?.state;
}

async function waitForState(
  app: string,
  id: string,
  cfg: FlyPreviewConfig,
  expected: string,
  timeoutMs = 60_000,
) {
  const until = Date.now() + timeoutMs;
  let observed: string | undefined;
  while (Date.now() < until) {
    observed = await machineState(app, id, cfg);
    if (observed === expected) return;
    await pause(2_000);
  }
  throw new Error(`${app} / ${id}: expected ${expected}, observed ${observed}`);
}

async function sshBanner(host: string, port: number) {
  return await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setTimeout(30_000);
    socket.once("data", (buffer) => {
      resolve(buffer.toString("utf8"));
      socket.destroy();
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SSH connection timed out"));
    });
  });
}

it.skipIf(process.env.FLY_HUB_LIFECYCLE_LIVE !== "1")(
  "creates, suspends, starts, stops, wakes on idle traffic, and terminates real machines",
  async () => {
    process.env.KODY_MASTER_KEY ??= randomBytes(32).toString("hex");
    const localEnv = process.env.FLY_HUB_LIVE_ENV_FILE ?? "../../apps/dashboard/.env.local";
    const token = process.env.FLY_API_TOKEN ?? readFileSync(localEnv, "utf8")
      .match(/^FLY_API_TOKEN=(.*)$/m)?.[1]
      ?.replace(/^['"]|['"]$/g, "");
    if (!token) throw new Error("FLY_API_TOKEN is required for the long idle test");
    const cfg: FlyPreviewConfig = {
      token,
      orgSlug: process.env.FLY_HUB_LIVE_ORG ?? "personal",
      defaultRegion: process.env.FLY_HUB_LIVE_REGION ?? "fra",
    };
    const owner = "flyhub-lifecycle-test";
    const suffix = randomBytes(4).toString("hex");
    const idleRepo = `idle-${suffix}`;
    const awakeRepo = `awake-${suffix}`;
    const reusedIdleApp = process.env.FLY_HUB_LIVE_IDLE_APP;
    const reusedAwakeApp = process.env.FLY_HUB_LIVE_AWAKE_APP;
    if (Boolean(reusedIdleApp) !== Boolean(reusedAwakeApp)) {
      throw new Error("Set both reuse app names or neither");
    }
    const idleApp = reusedIdleApp ?? managedMachineAppName(owner, idleRepo, cfg.orgSlug);
    const awakeApp = reusedAwakeApp ?? managedMachineAppName(owner, awakeRepo, cfg.orgSlug);
    const apps = [idleApp, awakeApp];
    const cleanupApps = reusedIdleApp ? [] : [...apps];
    try {
      const idle = reusedIdleApp ? {
        app: idleApp,
        machineId: (await listMachines(idleApp, cfg)).find((machine) =>
          machine.config?.env?.FLY_HUB_NAME === "Idle sleep test")?.id ?? "",
      } : await createManagedMachine({
        owner, repo: idleRepo, name: "Idle sleep test", size: "low",
        sleepWhenIdle: true, requestId: randomUUID(), cfg,
      });
      const awake = reusedAwakeApp ? {
        app: awakeApp,
        machineId: (await listMachines(awakeApp, cfg)).find((machine) =>
          machine.config?.env?.FLY_HUB_NAME === "Stay awake test")?.id ?? "",
      } : await createManagedMachine({
        owner, repo: awakeRepo, name: "Stay awake test", size: "low",
        sleepWhenIdle: false, requestId: randomUUID(), cfg,
      });
      if (!idle.machineId || !awake.machineId) throw new Error("Reusable test machines not found");
      const idleMachine = (await listMachines(idleApp, cfg)).find((machine) => machine.id === idle.machineId)!;
      const awakeMachine = (await listMachines(awakeApp, cfg)).find((machine) => machine.id === awake.machineId)!;
      if (reusedIdleApp) cleanupApps.push(...apps);
      expect(idleMachine.config?.services?.[0]).toMatchObject({ autostop: "suspend", autostart: true });
      expect(awakeMachine.config?.services?.[0]).toMatchObject({ autostop: false, autostart: true });
      console.log("LIVE: sleep settings persisted; both machines started");

      await suspendMachine(awakeApp, awake.machineId, cfg);
      await waitForState(awakeApp, awake.machineId, cfg, "suspended");
      console.log("LIVE: manual suspend passed");
      await startMachine(awakeApp, awake.machineId, cfg);
      await waitForState(awakeApp, awake.machineId, cfg, "started");
      console.log("LIVE: start after suspend passed");

      await stopMachine(awakeApp, awake.machineId, cfg);
      await waitForState(awakeApp, awake.machineId, cfg, "stopped");
      console.log("LIVE: manual stop passed");
      await startMachine(awakeApp, awake.machineId, cfg);
      await waitForState(awakeApp, awake.machineId, cfg, "started");
      console.log("LIVE: start after stop passed");

      // Fly Proxy checks idle capacity every few minutes. API polling does
      // not touch the public SSH service, so it does not keep it awake.
      const until = Date.now() + 12 * 60_000;
      let idleState: string | undefined;
      let nextUpdate = Date.now() + 60_000;
      while (Date.now() < until) {
        idleState = await machineState(idleApp, idle.machineId, cfg);
        if (idleState === "suspended") break;
        if (Date.now() >= nextUpdate) {
          console.log(`LIVE: waiting for Fly Proxy idle suspend; state=${idleState}`);
          nextUpdate = Date.now() + 60_000;
        }
        await pause(20_000);
      }
      expect(idleState, "Sleep when idle did not suspend within 12 minutes").toBe("suspended");
      expect(await machineState(awakeApp, awake.machineId, cfg)).toBe("started");
      console.log("LIVE: idle sleep on suspended; idle sleep off stayed started");

      const port = sshPorts(idleMachine.config)[0];
      expect(typeof port).toBe("number");
      let banner = "";
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          banner = await sshBanner(`${idleApp}.fly.dev`, port as number);
          break;
        } catch {
          await pause(3_000);
        }
      }
      expect(banner).toMatch(/^SSH-2\.0-/);
      await waitForState(idleApp, idle.machineId, cfg, "started");
      console.log("LIVE: SSH traffic woke the idle machine");

      await destroyMachine(awakeApp, awake.machineId, cfg);
      expect((await listMachines(awakeApp, cfg)).some((machine) => machine.id === awake.machineId)).toBe(false);
      console.log("LIVE: terminate removed the machine");
    } finally {
      const failedCleanup: string[] = [];
      for (const app of cleanupApps) {
        try {
          if (await appExists(app, cfg)) {
            await destroyApp(app, cfg);
            expect(await appExists(app, cfg)).toBe(false);
            console.log(`LIVE: removed disposable app ${app}`);
          }
        } catch {
          failedCleanup.push(app);
        }
      }
      if (failedCleanup.length) throw new Error(`Could not remove disposable apps: ${failedCleanup.join(", ")}`);
    }
  },
  16 * 60_000,
);
