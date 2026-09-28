import {
  useKodyActionState as useIntegrationKodyActionState,
  type UseKodyActionStateOptions,
} from "@kody-ade/kody-chat-dashboard/hooks/useKodyActionState";

import { useActionStateLiveStamp } from "./useConvexLive";

export type {
  ActionState,
  ActionStatus,
  UseKodyActionStateOptions,
} from "@kody-ade/kody-chat-dashboard/hooks/useKodyActionState";

/** Dashboard adapter: adds the host-owned Convex change signal. */
export function useKodyActionState(
  runId: string | null | undefined,
  options: UseKodyActionStateOptions = {},
) {
  const liveStamp = useActionStateLiveStamp(runId);
  return useIntegrationKodyActionState(runId, { ...options, liveStamp });
}
