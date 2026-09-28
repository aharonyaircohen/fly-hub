"use client";

import { useQuery } from "@tanstack/react-query";

import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import type { EngineSetupStatus } from "@dashboard/lib/engine/status-contract";

export function useEngineSetupStatus() {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ["engine-setup-status", auth?.owner, auth?.repo],
    enabled: Boolean(auth),
    staleTime: 5 * 60 * 1000,
    refetchOnMount: "always",
    queryFn: async (): Promise<EngineSetupStatus> => {
      const response = await fetch("/api/kody/engine/status", {
        headers: buildAuthHeaders(auth),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("engine_status_unavailable");
      return (await response.json()) as EngineSetupStatus;
    },
  });
}
