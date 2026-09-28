/**
 * @fileType library
 * @domain preview
 * @pattern host-injection-hook
 *
 * Host-injected reader for the repo's tracked branch-preview list. The list
 * lives in the host's dashboard config (`dashboard.json` in the backend,
 * a host-owned module the fly package must not depend on). Hosts wire the
 * real reader at startup (instrumentation.ts), mirroring the events
 * setEventFlushScheduler pattern. Without wiring, tracked-branch pushes
 * build nothing — graceful degradation, not an error.
 */

import type { Octokit } from "@octokit/rest";

export type TrackedBranchesReader = (
  octokit: Octokit,
  owner: string,
  repo: string,
) => Promise<string[]>;

// globalThis-backed: Next bundles this TS-source package separately per
// server entry (instrumentation vs. routes), so a module-level variable
// set at startup is invisible to other bundles.
const READER_KEY = Symbol.for("kody.fly.trackedBranchesReader");

type ReaderGlobal = { [READER_KEY]?: TrackedBranchesReader | null };

export function setTrackedBranchesReader(fn: TrackedBranchesReader): void {
  (globalThis as ReaderGlobal)[READER_KEY] = fn;
}

export function getTrackedBranchesReader(): TrackedBranchesReader | null {
  return (globalThis as ReaderGlobal)[READER_KEY] ?? null;
}
