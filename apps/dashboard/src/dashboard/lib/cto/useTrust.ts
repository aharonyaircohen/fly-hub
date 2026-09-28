"use client";
/**
 * @fileType hook
 * @domain kody
 * @pattern capability-trust-client
 * @ai-summary TanStack Query binding for the /trust page. Reads the capability-keyed
 *   trust ledger (GET /api/kody/cto/trust, backed by a Kody backend file) AND the
 *   capability roster (to show the agent identity each capability runs as), then projects both
 *   through the pure `summarizeTrust`.
 *
 *   Exposes `setTrust({ capability, op })` — a mutation over POST
 *   /api/kody/cto/trust (reset / graduate / degrade) that invalidates the trust
 *   query so the page reflects the new autonomy immediately.
 *
 *   Auth-scoped query keys (owner/repo): the ledger is per-repo. TTL ≥ 60s per
 *   CLAUDE.md rate-limit rule; the mutation invalidates on success.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth-context";
import { kodyApi } from "../api";
import {
  TRUST_MANIFEST_VERSION,
  applyCapabilityNeverAuto,
  applyCapabilityTrustLevel,
  applySubjectTrustOp,
  applySubjectTrustLevel,
  applyTrustOp,
  summarizeTrust,
  type TrustCapabilityStats,
  type TrustDecisionLogEntry,
  type TrustCapabilityView,
  type TrustLevel,
  type TrustManifest,
  type TrustOp,
  type TrustSubjectKey,
} from "./trust-state";

export const trustQueryKey = (owner?: string, repo?: string) =>
  ["cto-trust", owner ?? "", repo ?? ""] as const;

type TrustQueryPayload = Awaited<ReturnType<typeof kodyApi.cto.trust>>;
type TrustMutationInput =
  | { capability: string; subject?: never; op: TrustOp }
  | { capability?: never; subject: TrustSubjectKey; op: TrustOp }
  | { capability: string; subject?: never; level: TrustLevel }
  | { capability?: never; subject: TrustSubjectKey; level: TrustLevel }
  | { capability: string; subject?: never; neverAuto: boolean };

export interface UseTrustResult {
  /** Per-capability view rows (auto-first), or [] while loading. */
  groups: TrustCapabilityView[];
  /** Raw trust stats keyed by capability slug. */
  capabilities: Record<string, TrustCapabilityStats>;
  /** Repo-owned trigger policy for loops and workflows. */
  subjects: Record<TrustSubjectKey, TrustCapabilityStats>;
  /** Recent decision log (most recent last), bounded server-side. */
  log: TrustDecisionLogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  /** Refresh trust stats and the capability roster used to label them. */
  refetch: () => Promise<void>;
  /** Apply one whole-capability trust override; resolves once the write lands. */
  setTrust: (input: { capability: string; op: TrustOp }) => Promise<void>;
  /** Apply one managed subject trust override; resolves once the write lands. */
  setSubjectTrust: (input: {
    subject: TrustSubjectKey;
    op: TrustOp;
  }) => Promise<void>;
  /** Set one visible trust level for a runnable item. */
  setTrustLevel: (
    input:
      | { capability: string; level: TrustLevel }
      | { subject: TrustSubjectKey; level: TrustLevel },
  ) => Promise<void>;
  /** Pin/unpin a capability to approval-required regardless of earned trust. */
  setNeverAuto: (input: {
    capability: string;
    neverAuto: boolean;
  }) => Promise<void>;
  /** True while a `setTrust` mutation is in flight. */
  isMutating: boolean;
}

export function useTrust(): UseTrustResult {
  const { auth } = useAuth();
  const qc = useQueryClient();
  const key = trustQueryKey(auth?.owner, auth?.repo);
  const enabled = !!auth;

  const trustQuery = useQuery({
    queryKey: key,
    queryFn: () => kodyApi.cto.trust(),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 60_000 : false,
    refetchOnWindowFocus: true,
  });

  // Reuse the capabilities list only to map capability → agent identity.
  const capabilitiesQuery = useQuery({
    queryKey: ["capabilities", auth?.owner, auth?.repo],
    queryFn: () => kodyApi.capabilities.list(),
    enabled,
    staleTime: 60_000,
  });

  const mutation = useMutation<
    Awaited<ReturnType<typeof kodyApi.cto.setTrust>>,
    Error,
    TrustMutationInput,
    { previous?: TrustQueryPayload }
  >({
    mutationFn: (input: TrustMutationInput) =>
      kodyApi.cto.setTrust({
        ...input,
        ...(auth?.user?.login ? { actorLogin: auth.user.login } : {}),
      }),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TrustQueryPayload>(key);
      qc.setQueryData<TrustQueryPayload>(key, (current) =>
        applyTrustCacheOp(current, input),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData<TrustQueryPayload>(key, (current) => {
        if (!current) return current;
        const subjects = current.subjects ?? {};
        if (data.subject) {
          if (!data.stats) {
            const { [data.subject]: _removed, ...nextSubjects } = subjects;
            return { ...current, subjects: nextSubjects };
          }
          return {
            ...current,
            subjects: {
              ...subjects,
              [data.subject]: data.stats,
            },
          };
        }
        if (!data.capability) return current;
        if (!data.stats) {
          const { [data.capability]: _removed, ...capabilities } =
            current.capabilities;
          return { ...current, capabilities };
        }
        return {
          ...current,
          capabilities: {
            ...current.capabilities,
            [data.capability]: data.stats,
          },
        };
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const groups = useMemo<TrustCapabilityView[]>(() => {
    if (!trustQuery.data) return [];
    const manifest: TrustManifest = {
      version: TRUST_MANIFEST_VERSION,
      capabilities: trustQuery.data.capabilities,
      subjects: trustQuery.data.subjects ?? {},
      log: trustQuery.data.log,
    };
    const capabilityLinks = (capabilitiesQuery.data ?? []).map((d) => ({
      slug: d.slug,
      agent: d.agent ?? null,
    }));
    return summarizeTrust(manifest, capabilityLinks);
  }, [trustQuery.data, capabilitiesQuery.data]);

  return {
    groups,
    capabilities: trustQuery.data?.capabilities ?? {},
    subjects: trustQuery.data?.subjects ?? {},
    log: trustQuery.data?.log ?? [],
    isLoading: trustQuery.isLoading,
    isFetching: trustQuery.isFetching || capabilitiesQuery.isFetching,
    error: (trustQuery.error as Error | null) ?? null,
    refetch: async () => {
      await Promise.all([trustQuery.refetch(), capabilitiesQuery.refetch()]);
    },
    setTrust: async (input) => {
      await mutation.mutateAsync(input);
    },
    setSubjectTrust: async (input) => {
      await mutation.mutateAsync(input);
    },
    setTrustLevel: async (input) => {
      await mutation.mutateAsync(input);
    },
    setNeverAuto: async (input) => {
      await mutation.mutateAsync(input);
    },
    isMutating: mutation.isPending,
  };
}

function applyTrustCacheOp(
  current: TrustQueryPayload | undefined,
  input: TrustMutationInput,
): TrustQueryPayload | undefined {
  if (!current) return current;
  const baseManifest = {
    version: TRUST_MANIFEST_VERSION,
    capabilities: current.capabilities,
    subjects: current.subjects ?? {},
    log: current.log,
  };
  const manifest =
    "neverAuto" in input
      ? applyCapabilityNeverAuto(
          baseManifest,
          input.capability,
          input.neverAuto,
        )
      : "level" in input
        ? input.subject
          ? applySubjectTrustLevel(baseManifest, input.subject, input.level)
          : applyCapabilityTrustLevel(
              baseManifest,
              input.capability,
              input.level,
            )
        : input.subject
          ? applySubjectTrustOp(baseManifest, input.op, input.subject)
          : applyTrustOp(baseManifest, input.op, input.capability);
  return {
    ...current,
    capabilities: manifest.capabilities,
    subjects: manifest.subjects,
    log: manifest.log,
  };
}
