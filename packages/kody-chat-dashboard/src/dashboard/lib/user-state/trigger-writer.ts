/**
 * @fileType utility
 * @domain user-state
 * @pattern trigger-writer-install
 * @ai-summary Installs the user-state service as the trigger engine's state
 *   writer. Callable from any server entry — event-emitting routes call it
 *   directly so trigger execution never depends on the host's
 *   instrumentation having run in the same process.
 */
import "server-only";
import {
  setTriggerStateWriter,
  type TriggerStateWrite,
} from "@kody-ade/base/triggers";
import { setUserState, type UserStateServiceContext } from "./service";

/**
 * Install the trigger→user-state writer. Always overwrites: a stale writer
 * from an earlier bundle/startup must never shadow the current
 * implementation.
 */
export function ensureTriggerStateWriter(): void {
  setTriggerStateWriter(async (write: TriggerStateWrite) => {
    const ctx: UserStateServiceContext = {
      octokit: write.octokit,
      owner: write.owner,
      repo: write.repo,
      userId: write.userId,
      sessionId: write.sessionId,
    };
    await setUserState(ctx, write.namespace, write.data, {
      source: "system",
    });
  });
}
