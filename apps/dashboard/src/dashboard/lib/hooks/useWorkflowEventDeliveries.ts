"use client";

import { useQuery } from "@tanstack/react-query";
import { kodyApi, getStoredAuth } from "../api";
import type { WorkflowEventDelivery } from "../api/activity";

export const workflowEventDeliveriesQueryKey = [
  "activity",
  "workflow-events",
] as const;

const POLL_MS = 30_000;

export function useWorkflowEventDeliveries(limit = 20) {
  return useQuery<{
    events: WorkflowEventDelivery[];
    total: number;
    computedAt: string;
  }>({
    queryKey: [...workflowEventDeliveriesQueryKey, limit],
    queryFn: () => kodyApi.activity.workflowEvents(limit),
    enabled: !!getStoredAuth(),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    staleTime: POLL_MS,
  });
}
