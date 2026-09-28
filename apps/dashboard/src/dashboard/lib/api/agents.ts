import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Agent API ============

export interface Agent {
  /** Filename without `.md` — stable identity. */
  slug: string;
  title: string;
  body: string;
  /** Plain-language guidance for selecting this Agent as a specialist. */
  whenToUse?: string;
  /** The single Intent this Agent pursues when configured as live. */
  primaryIntent?: string;
  /** Capability slugs attached to this agent (loaded into its chat). */
  capabilities?: string[];
  /** Public Agents this Agent may delegate work to. */
  subagents?: string[];
  /** Product-owned assignments that cannot be removed. */
  lockedSubagents?: string[];
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
  /** Runtime resolution source. Local repo agent win over store agent. */
  source?: "local" | "builtin" | "store";
  /** Built-in definitions are immutable; Store definitions may be copied. */
  readOnly?: boolean;
}

export const staffApi = {
  list: async (): Promise<Agent[]> => {
    const res = await fetch(`${API_BASE}/agents`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ agent: Agent[] }>(res);
    return data.agent;
  },

  get: async (slug: string): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ agentMember: Agent }>(res);
    return data.agentMember;
  },

  create: async (data: {
    slug?: string;
    title: string;
    body: string;
    whenToUse?: string;
    primaryIntent?: string;
    capabilities?: string[];
    subagents?: string[];
    actorLogin?: string;
  }): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ agentMember: Agent }>(res);
    return payload.agentMember;
  },

  update: async (
    slug: string,
    data: {
      title?: string;
      body?: string;
      whenToUse?: string;
      primaryIntent?: string;
      capabilities?: string[];
      subagents?: string[];
      actorLogin?: string;
    },
  ): Promise<Agent> => {
    const res = await fetch(`${API_BASE}/agents/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ agentMember: Agent }>(res);
    return payload.agentMember;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/agents/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },

  /**
   * Send an ad-hoc message to an agent and run it like a one-shot capability.
   * Posts an `@kody agent-ask` directive on the control issue; the engine
   * runs the agentIdentity stateless and replies on that issue. When `actorLogin`
   * is set, the reply @-mentions the requester so it lands in their inbox.
   */
  dispatch: async (
    slug: string,
    data: { message: string; actorLogin?: string },
  ): Promise<{
    issueNumber: number;
    commentId: number;
    commentUrl: string;
  }> => {
    const res = await fetch(
      `${API_BASE}/agents/${encodeURIComponent(slug)}/dispatch`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      },
    );
    return handleResponse(res);
  },
};
