import type { Agent } from "./api";
import { KODY_CHAT_AGENT } from "@kody-ade/workspace/context/frontmatter";

export interface AgentUiPermissions {
  isCodeOwned: boolean;
  canConfigureIdentity: boolean;
  canConfigureSubagents: boolean;
  canDelete: boolean;
}

/** Keeps Agent identity ownership separate from configurable assignments. */
export function agentUiPermissions(
  agent: Pick<Agent, "slug" | "source">,
): AgentUiPermissions {
  const isCodeOwned = agent.source === "builtin";
  if (!isCodeOwned) {
    return {
      isCodeOwned: false,
      canConfigureIdentity: true,
      canConfigureSubagents: true,
      canDelete: true,
    };
  }

  return {
    isCodeOwned: true,
    canConfigureIdentity: false,
    canConfigureSubagents: agent.slug === KODY_CHAT_AGENT,
    canDelete: false,
  };
}
