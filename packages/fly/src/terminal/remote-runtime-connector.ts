/**
 * @fileType library
 * @domain terminal
 * @pattern host-injection-hook
 *
 * Host-injected remote runtime connector. The Brain feature lives in
 * @kody-ade/brain and Fly's terminal session orchestration needs to resolve
 * the Brain machine target when
 * a session requests `target: "brain"`. Hosts wire the real connector at
 * startup (instrumentation.ts) via `registerBrainHostHooks()` from
 * @kody-ade/brain, mirroring the fly `setBrainServiceResolver` /
 * `setEventFlushScheduler` pattern. Without wiring, brain-targeted
 * sessions fail with a clear error; non-brain sessions are unaffected.
 */

import type { TerminalTargetInput } from "@kody-ade/terminal/session";

import type { ServerProviderContext } from "../infrastructure/server-context";
import type { ServerProviderInventory } from "../infrastructure/server-machines";

/**
 * Structural mirror of the brain package's BrainTerminalWarning —
 * defined here so terminal does not import brain.
 */
export interface RemoteRuntimeWarning {
  code: string;
  message: string;
  desiredImageRef?: string;
  runningImageRef?: string | null;
  machineImageRef?: string | null;
}

export interface RemoteRuntimeConnectInput {
  context: ServerProviderContext;
  inventory: ServerProviderInventory;
  requestedTarget: TerminalTargetInput | null;
}

export interface RemoteRuntimeConnectDecision {
  targetInput: TerminalTargetInput | null;
  warnings: RemoteRuntimeWarning[];
}

export type RemoteRuntimeConnector = (
  input: RemoteRuntimeConnectInput,
) => Promise<RemoteRuntimeConnectDecision>;

// Next bundles this TS-source package separately into each server entry
// (instrumentation vs. route handlers), so a plain module-level variable
// registered at startup is invisible to other bundles. globalThis is the
// one registry every bundle in the process shares.
const CONNECTOR_KEY = Symbol.for("kody.terminal.remoteRuntimeConnector");

type ConnectorGlobal = { [CONNECTOR_KEY]?: RemoteRuntimeConnector | null };

export function setRemoteRuntimeConnector(fn: RemoteRuntimeConnector): void {
  (globalThis as ConnectorGlobal)[CONNECTOR_KEY] = fn;
}

export function getRemoteRuntimeConnector(): RemoteRuntimeConnector | null {
  return (globalThis as ConnectorGlobal)[CONNECTOR_KEY] ?? null;
}
