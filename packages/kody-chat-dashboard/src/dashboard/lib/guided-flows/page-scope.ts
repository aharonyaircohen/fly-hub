import { parseRepoScopedPath } from "@kody-ade/base/routes";
import type { KodyAuth } from "../auth-context";

/** The route, not the last selected repository, owns the Guided Flow scope. */
export function guidedFlowRequestAuth(
  pathname: string,
  auth: KodyAuth | null,
): KodyAuth | null {
  return parseRepoScopedPath(pathname) ? auth : null;
}
