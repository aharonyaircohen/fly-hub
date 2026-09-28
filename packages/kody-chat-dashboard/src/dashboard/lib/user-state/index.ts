/**
 * @fileType barrel
 * @domain user-state
 * @pattern user-state
 * @ai-summary Server barrel for the user-state contract.
 */
export {
  getUserState,
  setUserState,
  type UserStateServiceContext,
} from "./service";
export { ensureTriggerStateWriter } from "./trigger-writer";
export { getUserStateNamespaces, getUserStateNamespace } from "./config";
export { CORE_USER_STATE_NAMESPACES } from "./namespaces/core";
export { userFileKey } from "./user-key";
export {
  UserStateError,
  type UserStateAdapter,
  type UserStateAdapterContext,
  type UserStateDoc,
  type UserStateErrorCode,
  type UserStateMergePolicy,
  type UserStateNamespace,
} from "./types";
