/**
 * @fileType library
 * @domain runner
 * @pattern host-injection-hook
 *
 * Host-injected Brain service resolver. The Brain feature lives host-side
 * (it composes brain store/runtime modules the fly package must not depend
 * on), but Fly inventory wants to overlay the saved Brain machine. Hosts
 * wire the real resolver at startup (instrumentation.ts), mirroring the
 * events setEventFlushScheduler pattern. Without wiring, inventory simply
 * omits the saved Brain machine — graceful degradation, not an error.
 */

import type { ServerProviderMachineRow } from "@kody-ade/base/infrastructure/server-machine-model";

/**
 * Structural subset of the host Brain feature's BrainServiceResolution —
 * everything the fly inventory overlay actually touches.
 */
export interface ResolvedBrainService {
  app: string;
  orgSlug: string;
  defaultRegion: string;
  flyToken: string;
  stored: unknown;
  state: "running" | "suspended" | "stopped" | "off";
  url?: string;
  machineId?: string;
  machineImageRef?: string;
  machine?: ServerProviderMachineRow;
  reason?: string;
}

export interface ResolveBrainServiceInput {
  flyToken: string;
  account: string;
  githubToken: string;
  orgSlug: string;
  defaultRegion: string;
}

export type BrainServiceResolver = (
  input: ResolveBrainServiceInput,
) => Promise<ResolvedBrainService>;

// globalThis-backed: Next bundles this TS-source package separately per
// server entry (instrumentation vs. routes), so a module-level variable
// set at startup is invisible to other bundles.
const RESOLVER_KEY = Symbol.for("kody.fly.brainServiceResolver");

type ResolverGlobal = { [RESOLVER_KEY]?: BrainServiceResolver | null };

export function setBrainServiceResolver(fn: BrainServiceResolver): void {
  (globalThis as ResolverGlobal)[RESOLVER_KEY] = fn;
}

export function getBrainServiceResolver(): BrainServiceResolver | null {
  return (globalThis as ResolverGlobal)[RESOLVER_KEY] ?? null;
}
