import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { activityApi } from "../api/activity";

export function useAgentRuns(active: boolean) {
  const { auth } = useAuth();
  return useQuery({
    queryKey: ["activity", "agents", auth?.owner, auth?.repo],
    queryFn: () => activityApi.agentRuns(100),
    enabled: active && Boolean(auth),
    refetchInterval: active ? 15_000 : false,
    staleTime: 10_000,
  });
}
