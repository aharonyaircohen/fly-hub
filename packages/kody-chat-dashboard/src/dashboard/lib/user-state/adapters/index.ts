/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-adapter-registry
 * @ai-summary Registry of user-state adapters by name. "convex" stores
 *   tenant-scoped user data in the Kody backend; "cms:<collection>" bridges
 *   into the brand's CMS backend with ownership scoping.
 */
import "server-only";
import { UserStateError, type UserStateAdapter } from "../types";
import {
  cmsBridgeUserStateAdapter,
  parseCmsBridgeCollection,
} from "./cms-bridge";
import { convexUserStateAdapter } from "./convex";

const adapters = new Map<string, UserStateAdapter>([
  [convexUserStateAdapter.name, convexUserStateAdapter],
]);

export function getUserStateAdapter(name: string): UserStateAdapter {
  // `cms:<collection>` routes into the brand's CMS backend.
  if (parseCmsBridgeCollection(name)) return cmsBridgeUserStateAdapter;
  const adapter = adapters.get(name);
  if (!adapter) {
    throw new UserStateError(
      "adapter_not_found",
      `Unknown user-state adapter "${name}"`,
    );
  }
  return adapter;
}
