/**
 * @fileType bootstrap
 * @domain brain
 * @pattern host-injection-wiring
 *
 * One-call wiring of the Brain feature into the lower layers' injection
 * hooks. Hosts call this from instrumentation.ts at server startup:
 * - @kody-ade/fly gets the remote runtime connector (so
 *   `target: "brain"` sessions resolve the running Brain machine, with
 *   image-drift warnings).
 *
 * Brain depends on terminal and fly in one direction. Repository inventory
 * remains repo-owned and does not include the personal Brain machine.
 */
import { setRemoteRuntimeConnector } from "@kody-ade/fly/terminal/remote-runtime-connector";

import { readBrainRuntimeView } from "./runtime-manager";
import { connectBrainTerminal } from "./terminal-connect";

/** Wire Brain implementations into fly + terminal injection hooks. */
export function registerBrainHostHooks(): void {
  setRemoteRuntimeConnector(async ({ context, inventory, requestedTarget }) => {
    const runtime = await readBrainRuntimeView(
      context.account,
      context.githubToken,
    );
    return connectBrainTerminal({ runtime, inventory, requestedTarget });
  });
}
