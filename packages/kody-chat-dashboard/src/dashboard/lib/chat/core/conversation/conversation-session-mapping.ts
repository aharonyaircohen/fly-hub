import type { SessionMeta } from "../../../chat-types";

export function runtimeForAgentKey(agentKey?: string) {
  if (agentKey === "brain" || agentKey === "brain-fly") {
    return { kind: "brain" as const, brainId: agentKey };
  }
  if (agentKey === "kody-live") {
    return { kind: "live" as const, profileId: agentKey };
  }
  if (agentKey?.startsWith("engine")) {
    return { kind: "engine" as const, profileId: agentKey };
  }
  return { kind: "direct" as const, modelId: agentKey ?? "default" };
}

export function storedAttachmentId(id: string): string {
  return id.includes("::") ? id.slice(id.indexOf("::") + 2) : id;
}

export function sessionFromList(value: Record<string, unknown>): SessionMeta {
  const storedScope =
    value.scope && typeof value.scope === "object"
      ? (value.scope as Record<string, unknown>)
      : null;
  return {
    id: String(value.conversationId),
    title: String(value.title ?? "New conversation"),
    preview: typeof value.preview === "string" ? value.preview : undefined,
    createdAt: String(value.createdAt),
    updatedAt: String(value.updatedAt),
    messageCount:
      typeof value.messageCount === "number" ? value.messageCount : 0,
    pinned: value.pinned === true,
    repository:
      storedScope?.kind === "repository" &&
      typeof storedScope.owner === "string" &&
      typeof storedScope.repo === "string"
        ? { owner: storedScope.owner, repo: storedScope.repo }
        : undefined,
    agencyAgent:
      value.activeAgent && typeof value.activeAgent === "object"
        ? (value.activeAgent as SessionMeta["agencyAgent"])
        : { slug: "kody", title: "Kody" },
    machineAccess:
      value.machineAccess === "local" || value.machineAccess === "brain"
        ? value.machineAccess
        : "none",
  };
}
