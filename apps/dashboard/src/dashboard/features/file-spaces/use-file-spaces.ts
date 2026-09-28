"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@dashboard/lib/auth-context";
import { fetchFileSpaces } from "./client";

export const FILE_SPACES_QUERY_KEY = "file-spaces";

export function useFileSpaces() {
  const { auth } = useAuth();
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  return useQuery({
    queryKey: [FILE_SPACES_QUERY_KEY, scope],
    queryFn: () => fetchFileSpaces(auth!),
    enabled: Boolean(auth?.owner && auth.repo),
    staleTime: 30_000,
  });
}
