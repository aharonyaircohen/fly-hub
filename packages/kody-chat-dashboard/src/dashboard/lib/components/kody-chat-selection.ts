/**
 * @fileType hook
 * @domain kody
 * @pattern kody-chat-selection
 * @ai-summary Agent/model selection extracted from KodyChat. Existing
 *   conversations derive their selection from the saved session agent key;
 *   an unsaved conversation keeps a draft pick; otherwise the configured
 *   catalog default is used. The hook also owns dropdown entries, removed-
 *   entry family fallback, reasoning-effort wiring, and host locks.
 *
 *   Placement note: lives in components/ next to the other phase-1.6
 *   extractions (kody-chat-live-runner.ts / kody-chat-send.ts /
 *   kody-chat-data.ts) — it is KodyChat wiring, not chat/core logic.
 *   The pure decisions (default resolution, family snap) are exported
 *   as plain functions so they unit-test without a renderer.
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { AGENT_KODY, AGENTS, type AgentConfig, type AgentId } from "../agents";
import {
  buildAgentList,
  shouldWaitForChatCatalogResolution,
  type BrainChatModelEntry,
  type ChatDropdownEntry,
  type ChatModelEntry,
} from "../chat/platform/agent-entries";
import { readReasoningEffort } from "../reasoning-pref";
import type { ModelReasoning } from "../chat/core/reasoning-adapter";
import type { UseConversationSessionsResult } from "../chat/core/conversation/use-conversation-sessions";
import { AUTOMATIC_MODEL_ID } from "@kody-ade/base/variables/models";

/**
 * Resolve the configured catalog default — the value a session with
 * no saved pick falls back to. Used as the catch-all when
 * a session's `agentKey` is missing (legacy sessions created
 * before this field existed) or points at an entry that has
 * since been removed from the list.
 *
 * Resolution order:
 *   1. A Kody model with `default: true` on the Models page.
 *   2. First configured Kody model.
 *   3. Brain if configured.
 *   4. First available Live entry.
 *
 * Renderers are part of the in-process Kody chat protocol. If a repo has
 * a Kody model configured but no saved default, default to that renderer-
 * capable path instead of Live.
 */
export function resolveDefaultAgentEntry(options: {
  chatModels: ChatModelEntry[];
  automaticDefault?: boolean;
  brainConfigured: boolean;
  agentList: ChatDropdownEntry[];
}): ChatDropdownEntry | null {
  const { chatModels, automaticDefault, brainConfigured, agentList } = options;
  if (automaticDefault) {
    const entry = agentList.find(
      (candidate) => candidate.key === `kody:${AUTOMATIC_MODEL_ID}`,
    );
    if (entry) return entry;
  }
  const defModel = chatModels.find(
    (m) => m.default === true && m.enabled !== false,
  );
  if (defModel) {
    const entry = agentList.find((e) => e.key === `kody:${defModel.id}`);
    if (entry) return entry;
  }
  const firstKodyModel = agentList.find((e) => e.agentId === "kody");
  if (firstKodyModel) return firstKodyModel;
  if (
    brainConfigured ||
    agentList.some(
      (entry) => entry.agentId === "brain" || entry.agentId === "brain-fly",
    )
  ) {
    return (
      agentList.find(
        (entry) => entry.agentId === "brain" || entry.agentId === "brain-fly",
      ) ?? null
    );
  }
  return (
    agentList.find(
      (entry) =>
        entry.agentId === "kody-live" || entry.agentId === "kody-live-fly",
    ) ?? null
  );
}

/**
 * Old runner/Brain keys snap to the matching available backend. Removed
 * custom models fall back to another custom model, then Live.
 */
export function familySnapEntry(
  key: string,
  agentList: ChatDropdownEntry[],
): ChatDropdownEntry | null {
  if (key === "kody-live" || key === "kody-live-fly") {
    return (
      agentList.find(
        (entry) =>
          entry.agentId === "kody-live" || entry.agentId === "kody-live-fly",
      ) ?? null
    );
  }
  if (key === "brain" || key === "brain-fly") {
    return (
      agentList.find(
        (entry) => entry.agentId === "brain" || entry.agentId === "brain-fly",
      ) ?? null
    );
  }
  if (key === "claude" || key.startsWith("kody:")) {
    return (
      agentList.find((entry) => entry.agentId === "kody") ??
      agentList.find(
        (entry) =>
          entry.agentId === "kody-live" || entry.agentId === "kody-live-fly",
      ) ??
      null
    );
  }
  return null;
}

/**
 * A client Brand pins a server-owned model but has no Dashboard user model
 * catalog. Give that locked model a local display entry so the composer can
 * become ready; the chat route remains authoritative for model resolution.
 */
export function addLockedModelEntry(
  agentList: ChatDropdownEntry[],
  lockedAgentId?: AgentId,
  lockedModelId?: string | null,
): ChatDropdownEntry[] {
  if (
    lockedAgentId !== "kody" ||
    !lockedModelId ||
    agentList.some(
      (entry) => entry.agentId === "kody" && entry.modelId === lockedModelId,
    )
  ) {
    return agentList;
  }
  return [
    ...agentList,
    {
      key: `kody:${lockedModelId}`,
      agentId: "kody",
      modelId: lockedModelId,
      name: lockedModelId,
      description: "Brand model",
      icon: AGENT_KODY.icon,
      reasoning: null,
    },
  ];
}

export function resolveSelectedAgentEntry(options: {
  activeSessionId?: string;
  activeSessionAgentKey?: string;
  draftEntryKey: string | null;
  defaultEntry: ChatDropdownEntry | null;
  agentList: ChatDropdownEntry[];
  lockedAgentId?: AgentId;
  lockedModelId?: string | null;
}): ChatDropdownEntry | null {
  const {
    activeSessionId,
    activeSessionAgentKey,
    draftEntryKey,
    defaultEntry,
    agentList,
    lockedAgentId,
    lockedModelId,
  } = options;
  if (lockedAgentId) {
    return (
      agentList.find(
        (entry) =>
          entry.agentId === lockedAgentId &&
          (lockedModelId === undefined ||
            (entry.modelId ?? null) === lockedModelId),
      ) ?? familySnapEntry(lockedAgentId, agentList)
    );
  }

  const selectedKey = activeSessionId
    ? activeSessionAgentKey
    : (draftEntryKey ?? undefined);
  if (!selectedKey) return defaultEntry;
  return (
    agentList.find((entry) => entry.key === selectedKey) ??
    familySnapEntry(selectedKey, agentList) ??
    defaultEntry
  );
}

export interface UseAgentSelectionOptions {
  /** Host pins an agent (e.g. the Vibe page) — the picker is locked. */
  lockedAgentId?: AgentId;
  /** Host pins a gateway model while still using the in-process Kody backend. */
  lockedModelId?: string | null;
  /** Brain visibility — per-user Settings entry (URL + API key). */
  brainConfigured: boolean;
  /** Per-repo vault FLY_API_TOKEN probe result (kody-chat-data). */
  flyConfigured: boolean;
  /** Repo-wide "Repo Brain" chat row opt-in (kody-chat-data). */
  brainFlyChatEnabled: boolean;
  /** User-managed model list + loaded flag (kody-chat-data). */
  chatModels: ChatModelEntry[];
  chatModelsLoaded: boolean;
  automaticDefault?: boolean;
  /** Personal Brain model list from /brain. */
  brainModels: BrainChatModelEntry[];
  /** The session store — saved conversation model picks live on it. */
  sessionHook: UseConversationSessionsResult;
}

export interface UseAgentSelectionResult {
  /** True once the current session/default has resolved against the catalog. */
  selectionReady: boolean;
  /** One resolved target consumed by rendering and turn dispatch. */
  selection: {
    agentId: AgentId;
    modelId: string | null;
    entry: ChatDropdownEntry | null;
    agent: AgentConfig;
    reasoning: ModelReasoning | null;
    reasoningEffort: string | null;
  };
  selectEntry: (entry: ChatDropdownEntry) => void;
  agentMenuOpen: boolean;
  setAgentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setReasoningEffort: React.Dispatch<React.SetStateAction<string | null>>;
  /** Every dropdown row currently available. */
  agentList: ChatDropdownEntry[];
}

/**
 * Agent/model selection state + sync. The active session's `agentKey`
 * is the source of truth for the visible agent; this hook owns the
 * read-only resolution chain (session pick → family snap → default).
 */
export function useAgentSelection(
  options: UseAgentSelectionOptions,
): UseAgentSelectionResult {
  const {
    lockedAgentId,
    lockedModelId,
    brainConfigured,
    flyConfigured,
    brainFlyChatEnabled,
    chatModels,
    chatModelsLoaded,
    automaticDefault,
    brainModels,
    sessionHook,
  } = options;
  const {
    activeSession,
    hydrated: sessionHydrated,
    setSessionAgent,
  } = sessionHook;
  const activeSessionId = activeSession?.id;
  const activeSessionAgentKey = activeSession?.agentKey;

  const [draftEntryKey, setDraftEntryKey] = useState<string | null>(null);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  // Thinking-level state. The chat header shows a small `🧠` dropdown
  // next to the agent picker when the current model declares a
  // `reasoning` block (or one can be auto-detected from `modelName`).
  // The pick is persisted per (repo, modelId) so switching models
  // doesn't reset your "High" on Claude when you swap to GPT-5. Sent
  // on every chat request as `body.reasoningEffort`; the chat route
  // translates it to the provider's wire shape at request time.
  const [reasoningEffort, setReasoningEffort] = useState<string | null>(null);
  const agentList = addLockedModelEntry(
    buildAgentList(
      brainConfigured,
      flyConfigured,
      brainFlyChatEnabled,
      chatModels,
      brainModels,
    ),
    lockedAgentId,
    lockedModelId,
  );

  // Default-entry resolution — see resolveDefaultAgentEntry above.
  const defaultAgentEntry = useMemo<ChatDropdownEntry | null>(
    () =>
      resolveDefaultAgentEntry({
        chatModels,
        automaticDefault,
        brainConfigured,
        agentList,
      }),
    [chatModels, automaticDefault, brainConfigured, agentList],
  );

  const catalogReady = !shouldWaitForChatCatalogResolution({
    sessionHydrated,
    chatModelsLoaded,
  });
  const currentEntry =
    (lockedAgentId || catalogReady) && agentList.length > 0
      ? resolveSelectedAgentEntry({
          activeSessionId,
          activeSessionAgentKey,
          draftEntryKey,
          defaultEntry: defaultAgentEntry,
          agentList,
          lockedAgentId,
          lockedModelId,
        })
      : null;
  const selectionReady = currentEntry !== null;
  const selectedAgentId = currentEntry?.agentId ?? lockedAgentId ?? "kody-live";
  const selectedModelId = currentEntry?.modelId ?? lockedModelId ?? null;
  const currentAgent = AGENTS[selectedAgentId] ?? AGENT_KODY;
  const currentReasoning = currentEntry?.reasoning ?? null;

  const selectEntry = useCallback(
    (entry: ChatDropdownEntry) => {
      if (lockedAgentId) return;
      if (activeSessionId) {
        setSessionAgent(activeSessionId, entry.key);
      } else {
        setDraftEntryKey(entry.key);
      }
    },
    [activeSessionId, lockedAgentId, setSessionAgent],
  );

  const effectiveReasoningEffort = useMemo(() => {
    if (!currentReasoning) return null;
    if (
      reasoningEffort &&
      currentReasoning.efforts.some(
        (effort) => effort.value === reasoningEffort,
      )
    ) {
      return reasoningEffort;
    }
    if (selectedModelId) {
      const stored = readReasoningEffort(selectedModelId);
      if (
        stored &&
        currentReasoning.efforts.some((effort) => effort.value === stored)
      ) {
        return stored;
      }
    }
    return currentReasoning.default;
  }, [currentReasoning, reasoningEffort, selectedModelId]);

  return {
    selectionReady,
    selection: {
      agentId: selectedAgentId,
      modelId: selectedModelId,
      entry: currentEntry,
      agent: currentAgent,
      reasoning: currentReasoning,
      reasoningEffort: effectiveReasoningEffort,
    },
    selectEntry,
    agentMenuOpen,
    setAgentMenuOpen,
    setReasoningEffort,
    agentList,
  };
}
