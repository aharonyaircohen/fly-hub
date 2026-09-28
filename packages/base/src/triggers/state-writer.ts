/**
 * @fileType utility
 * @domain triggers
 * @pattern trigger-state-writer-hook
 * @ai-summary Injection seam between the base trigger sink and the product's
 *   user-state service: base cannot import kody-chat, so the host installs
 *   its `setUserState` wrapper at startup via `setTriggerStateWriter()`.
 *   globalThis-backed for the same reason as the event flush scheduler —
 *   Next bundles this TS-source package separately per server entry.
 */
import type { Octokit } from "@octokit/rest";

export interface TriggerStateWrite {
  octokit: Octokit;
  owner: string;
  repo: string;
  userId: string;
  sessionId: string | null;
  namespace: string;
  data: Record<string, unknown>;
}

export type TriggerStateWriter = (write: TriggerStateWrite) => Promise<void>;

const WRITER_KEY = Symbol.for("kody.triggers.stateWriter");

type WriterGlobal = { [WRITER_KEY]?: TriggerStateWriter };

/** Install the product's user-state writer (called once at host startup). */
export function setTriggerStateWriter(writer: TriggerStateWriter): void {
  (globalThis as WriterGlobal)[WRITER_KEY] = writer;
}

export function getTriggerStateWriter(): TriggerStateWriter | null {
  return (globalThis as WriterGlobal)[WRITER_KEY] ?? null;
}
