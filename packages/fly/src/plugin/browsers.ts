/**
 * @fileType plugin
 * @domain infrastructure
 * @pattern fly-browser-provider
 * @ai-summary Fly adapter for isolated interactive Chromium sessions. Reuses
 *   the shared Fly Machines client; browser lifecycle stays separate from
 *   runner and deployment providers.
 */

import { createHash } from "node:crypto";

import type { BrowserProvider } from "@kody-ade/base/infrastructure/contracts";
import {
  allocateSharedIps,
  appExists,
  createApp,
  createMachine,
  destroyMachine,
  flyHostname,
  getMachineDiagnostic,
  listMachines,
  startMachine,
  updateMachineDefinition,
  waitForMachineStarted,
  type FlyPreviewConfig,
} from "./previews/machines-client";

export { getMachineDiagnostic as getBrowserMachineDiagnostic };

const BROWSER_READY_TIMEOUT_MS = 60_000;
const BROWSER_MACHINE_TRANSITION_TIMEOUT_MS = 60_000;
const BROWSER_MACHINE_CPUS = 2;
const BROWSER_MACHINE_MEMORY_MB = 2_048;

async function waitForBrowserMachineReplacement(
  appName: string,
  machineId: string,
  config: FlyPreviewConfig,
): Promise<Awaited<ReturnType<typeof listMachines>>[number]> {
  const deadline = Date.now() + BROWSER_MACHINE_TRANSITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const machine = (await listMachines(appName, config)).find(
      (candidate) => candidate.id === machineId,
    );
    if (!machine) throw new Error("browser_machine_not_found");
    if (machine.state !== "replacing") return machine;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("browser_machine_transition_timeout");
}

export async function ensureBrowserSessionReady(
  session: FlyBrowserSession,
): Promise<void> {
  const diagnostic = await getMachineDiagnostic(
    session.appName,
    session.machineId,
    session.config,
  );
  if (!diagnostic) throw new Error("browser_machine_not_found");
  if (diagnostic.state !== "started") {
    await startMachine(session.appName, session.machineId, session.config);
  }

  const deadline = Date.now() + BROWSER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${session.endpoint}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
    } catch {
      // Fly proxy can reset connections while a suspended Machine is waking.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("browser_machine_not_ready");
}

export interface CreateFlyBrowserSessionInput {
  owner: string;
  repo: string;
  actorId: string;
  sessionId: string;
  initialUrl: string;
  image: string;
  config: FlyPreviewConfig;
  verifyKey: string;
}

export interface FlyBrowserSession {
  providerId: "fly";
  sessionId: string;
  appName: string;
  machineId: string;
  state: string;
  region: string;
  endpoint: string;
  config: FlyPreviewConfig;
  accessTicket?: string;
}

export type FlyBrowserAction =
  | {
      type: "navigate";
      url: string;
      allowedOrigins?: string[];
      capabilitySlug?: string;
    }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "viewport"; width: number; height: number }
  | { type: "screenshot" }
  | { type: "snapshot" }
  | {
      type: "click";
      selector: string;
      allowedOrigins?: string[];
      capabilitySlug?: string;
    }
  | {
      type: "fill";
      selector: string;
      value: string;
      allowedOrigins?: string[];
      capabilitySlug?: string;
    }
  | {
      type: "upload";
      selector: string;
      uploadId: string;
      allowedOrigins: string[];
      capabilitySlug: string;
    }
  | {
      type: "scroll";
      selector?: string;
      deltaY: number;
      allowedOrigins?: string[];
      capabilitySlug?: string;
    }
  | {
      type: "wait";
      ms: number;
      allowedOrigins?: string[];
      capabilitySlug?: string;
    }
  | { type: "pick" }
  | { type: "pickResult" }
  | { type: "cancelPick" }
  | { type: "perf" }
  | { type: "edit"; command: unknown }
  | { type: "undoEdit" }
  | { type: "resetEdits"; selector?: string }
  | { type: "recordStart" }
  | { type: "recordStop" }
  | {
      type: "pointer";
      action: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      deltaX?: number;
      deltaY?: number;
      button?: "left" | "middle" | "right";
    }
  | { type: "keyboard"; action: "down" | "up" | "insertText"; key: string };

export interface FlyBrowserActionResult {
  ok: boolean;
  url?: string;
  title?: string;
  page?: {
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    revision: number;
  };
  data?: unknown;
  error?: string;
}

function safeNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export function browserAppName(input: {
  owner: string;
  repo: string;
  actorId: string;
}): string {
  const readable = safeNamePart(`${input.owner}-${input.repo}`) || "repo";
  const hash = createHash("sha256")
    .update(`${input.owner}/${input.repo}`)
    .digest("hex")
    .slice(0, 10);
  return `kody-browser-${readable}-${hash}`.slice(0, 63);
}

function browserMachineEnv(session: {
  config?: Record<string, unknown>;
}): Record<string, unknown> {
  const env = session.config?.env;
  return env && typeof env === "object" ? (env as Record<string, unknown>) : {};
}

function browserMachineActor(session: {
  config?: Record<string, unknown>;
}): string | null {
  const actorId = browserMachineEnv(session).KODY_BROWSER_ACTOR_ID;
  return typeof actorId === "string" ? actorId : null;
}

async function postBrowserAction(
  session: FlyBrowserSession,
  action: FlyBrowserAction,
): Promise<FlyBrowserActionResult> {
  const response = await fetch(`${session.endpoint}/api/browser/action`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session.accessTicket
        ? { Authorization: `Bearer ${session.accessTicket}` }
        : {}),
    },
    body: JSON.stringify(action),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    return { ok: false, error: `browser_action_${response.status}` };
  }
  return (await response.json()) as FlyBrowserActionResult;
}

export type FlyBrowserProvider = BrowserProvider<
  CreateFlyBrowserSessionInput,
  FlyBrowserSession,
  FlyBrowserAction,
  FlyBrowserActionResult
>;

export const flyBrowserProvider: FlyBrowserProvider = {
  id: "fly",
  area: "browsers",
  capabilities: new Set([
    "real-browser",
    "expose-http",
    "wake",
    "suspend",
    "destroy",
    "inventory",
  ]),
  async createSession(input) {
    const appName = browserAppName(input);
    const appAlreadyExists = await appExists(appName, input.config);
    if (!appAlreadyExists) {
      await createApp(appName, input.config);
    }

    let machines = await listMachines(appName, input.config);
    if (!appAlreadyExists || machines.length === 0) {
      await allocateSharedIps(appName, input.config);
    }
    let existing = machines.find(
      (machine) => browserMachineActor(machine) === input.actorId,
    );
    if (existing?.state === "replacing") {
      existing = await waitForBrowserMachineReplacement(
        appName,
        existing.id,
        input.config,
      );
    } else if (existing?.state === "starting") {
      await waitForMachineStarted(appName, existing.id, input.config);
      machines = await listMachines(appName, input.config);
      existing = machines.find(
        (machine) => browserMachineActor(machine) === input.actorId,
      );
      if (!existing) throw new Error("browser_machine_not_found");
    }
    const machine = existing
      ? existing
      : await createMachine(
          {
            appName,
            region: input.config.defaultRegion,
            image: input.image,
            sshUsername: "browser",
            internalPort: 8080,
            memoryMb: BROWSER_MACHINE_MEMORY_MB,
            cpus: BROWSER_MACHINE_CPUS,
            env: {
              KODY_BROWSER_SESSION_ID: input.sessionId,
              KODY_BROWSER_REPOSITORY: `${input.owner}/${input.repo}`,
              KODY_BROWSER_ACTOR_ID: input.actorId,
              KODY_BROWSER_INITIAL_URL: input.initialUrl,
              KODY_BROWSER_VERIFY_KEY: input.verifyKey,
            },
          },
          input.config,
        );

    const existingEnv = existing ? browserMachineEnv(existing) : {};
    if (
      existing &&
      (existing.config?.image !== input.image ||
        existingEnv.KODY_BROWSER_VERIFY_KEY !== input.verifyKey ||
        existingEnv.KODY_BROWSER_SESSION_ID !== input.sessionId ||
        existingEnv.KODY_BROWSER_REPOSITORY !==
          `${input.owner}/${input.repo}` ||
        existing.config?.guest?.cpus !== BROWSER_MACHINE_CPUS ||
        existing.config?.guest?.memory_mb !== BROWSER_MACHINE_MEMORY_MB)
    ) {
      await updateMachineDefinition(
        appName,
        existing.id,
        {
          image: input.image,
          guest: {
            cpu_kind: "shared",
            cpus: BROWSER_MACHINE_CPUS,
            memory_mb: BROWSER_MACHINE_MEMORY_MB,
          },
          env: {
            KODY_BROWSER_SESSION_ID: input.sessionId,
            KODY_BROWSER_REPOSITORY: `${input.owner}/${input.repo}`,
            KODY_BROWSER_ACTOR_ID: input.actorId,
            KODY_BROWSER_VERIFY_KEY: input.verifyKey,
            KODY_BROWSER_INITIAL_URL: input.initialUrl,
          },
        },
        input.config,
      );
      machines = await listMachines(appName, input.config);
      existing = machines.find(
        (candidate) => browserMachineActor(candidate) === input.actorId,
      );
      if (!existing) throw new Error("browser_machine_not_found");
      if (existing.state === "replacing") {
        existing = await waitForBrowserMachineReplacement(
          appName,
          existing.id,
          input.config,
        );
      }
    }

    if (existing && existing.state !== "started") {
      if (existing.state !== "starting") {
        await startMachine(appName, existing.id, input.config);
      }
      await waitForMachineStarted(appName, existing.id, input.config);
    }

    const activeMachine = existing ?? machine;

    return {
      providerId: "fly",
      sessionId: input.sessionId,
      appName,
      machineId: activeMachine.id,
      state: activeMachine.state,
      region: activeMachine.region,
      endpoint: flyHostname(appName),
      config: input.config,
    };
  },
  act(session, action) {
    return postBrowserAction(session, action);
  },
  async closeSession(session) {
    await destroyMachine(session.appName, session.machineId, session.config);
  },
};
