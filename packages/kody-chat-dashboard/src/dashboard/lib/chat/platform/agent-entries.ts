/**
 * @fileType config
 * @domain kody
 * @pattern chat-entry-list
 * @ai-summary Builds the selectable chat backend/model entry list shared by
 *   the chat picker and default-chat settings.
 */

import { AGENTS, type AgentConfig, type AgentId } from "../../agents";
import {
  resolveReasoning,
  type ModelReasoning,
} from "../core/reasoning-adapter";
import {
  AUTOMATIC_MODEL_ID,
  chatModelScopeFromId,
  storedChatModelId,
} from "@kody-ade/base/variables/models";
import { isBuiltInChatModelId, OPENCODE_FREE_MODEL_ID } from "../model-catalog";

/** A single selectable row in the chat agent picker. */
export interface ChatDropdownEntry {
  key: string;
  agentId: AgentId;
  modelId: string | null;
  name: string;
  description: string;
  icon: AgentConfig["icon"];
  /**
   * Effective thinking config for this entry. `null` when the model has
   * no `reasoning` block AND the model-name auto-detect couldn't pick
   * one — the chat header hides the `🧠` dropdown in that case.
   * Surfaced here so the UI never reaches into the raw `ChatModel` list.
   */
  reasoning: ModelReasoning | null;
  /** Runtime command selected for a personal Brain model. */
  runtime?: string;
  modelGroup?: "built-in" | "user";
}

/** A chat model from the configured + embedded catalog. */
export interface ChatModelEntry {
  id: string;
  label: string;
  scope?: "personal" | "repo";
  enabled?: boolean;
  automatic?: boolean;
  speech?: boolean;
  default?: boolean;
}

/** A personal Brain model configured on the /brain page. */
export interface BrainChatModelEntry {
  id: string;
  name: string;
  runtime?: string;
  enabled?: boolean;
  default?: boolean;
}

/**
 * The default cannot be resolved until the async model catalog finishes
 * loading. Waiting for the catalog prevents the initial Live fallback from
 * being persisted before the embedded model becomes available.
 */
export function shouldWaitForChatCatalogResolution({
  sessionHydrated,
  chatModelsLoaded,
}: {
  sessionHydrated: boolean;
  chatModelsLoaded: boolean;
}): boolean {
  if (!sessionHydrated) return true;
  if (!chatModelsLoaded) return true;
  return false;
}

/**
 * Build the ordered list of selectable chat entries.
 *
 * Live is always visible because it is the chat's fallback. Brain is visible
 * when configured; Repo Brain replaces it when its Fly chat toggle is on.
 */
export function buildAgentList(
  brainConfigured: boolean,
  flyConfigured: boolean,
  brainFlyChatEnabled: boolean,
  models: ChatModelEntry[],
  brainModels: BrainChatModelEntry[] = [],
): ChatDropdownEntry[] {
  const entries: ChatDropdownEntry[] = [];
  const live = AGENTS[flyConfigured ? "kody-live-fly" : "kody-live"];
  entries.push({
    key: live.id,
    agentId: live.id,
    modelId: null,
    name: "Hermes",
    description: "Uses the default model in Hermes",
    icon: live.icon,
    reasoning: null,
  });

  const brain =
    flyConfigured && brainFlyChatEnabled
      ? AGENTS["brain-fly"]
      : brainConfigured || brainModels.length > 0
        ? AGENTS.brain
        : null;
  if (brain) {
    const configuredBrainModels = brainModels.filter(
      (model) => model.enabled !== false,
    );
    if (configuredBrainModels.length > 0) {
      entries.push(
        ...configuredBrainModels.map((model) => ({
          key: `${brain.id}:${model.id}`,
          agentId: brain.id,
          modelId: model.id,
          name: model.name,
          description: brain.description,
          icon: brain.icon,
          reasoning: null,
          runtime: model.runtime,
          modelGroup: "user" as const,
        })),
      );
    } else {
      entries.push({
        key: brain.id,
        agentId: brain.id,
        modelId: null,
        name: brain.name,
        description: brain.description,
        icon: brain.icon,
        reasoning: null,
      });
    }
  }

  // One row per enabled user-managed model. All route through the in-process
  // gateway path (`/api/kody/chat/kody`) with the model id forwarded in the
  // request body.
  const kody = AGENTS.kody;
  const automaticModels = models.filter(
    (model) => model.enabled !== false && model.automatic === true,
  );
  if (automaticModels.length >= 2) {
    entries.push({
      key: `kody:${AUTOMATIC_MODEL_ID}`,
      agentId: "kody",
      modelId: AUTOMATIC_MODEL_ID,
      name: "Automatic",
      description: "Uses selected models in order when rate limited",
      icon: kody.icon,
      reasoning: null,
    });
  }
  for (const m of models) {
    if (m.enabled === false) continue;
    const scope = m.scope ?? chatModelScopeFromId(m.id) ?? undefined;
    const builtIn =
      isBuiltInChatModelId(m.id) || m.id === OPENCODE_FREE_MODEL_ID;
    entries.push({
      key: `kody:${m.id}`,
      agentId: "kody",
      modelId: m.id,
      name: m.label,
      modelGroup: builtIn ? "built-in" : "user",
      description:
        m.id === "opencode-free"
          ? "Automatically tries available free models · Chats may be used for training"
          : `${scope === "repo" ? "Repository · " : ""}${storedChatModelId(m.id)}`,
      icon: kody.icon,
      reasoning: resolveReasoning(m),
    });
  }
  return entries;
}
