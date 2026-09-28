import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Context API ============

export interface ContextEntry {
  /** Filename without `.md` — stable identity, also the entry heading. */
  slug: string;
  /** Entry markdown (frontmatter-free). */
  body: string;
  /** Owning agent-member slugs from `agent:` frontmatter (`["kody"]` default for legacy files). */
  agent: string[];
  /** Git blob sha. */
  sha: string;
  /** Last commit timestamp affecting this file (ISO8601). */
  updatedAt: string;
  /** Convenience link to the file on github.com. */
  htmlUrl: string;
}

export const contextApi = {
  list: async (): Promise<ContextEntry[]> => {
    const res = await fetch(`${API_BASE}/context`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ entries: ContextEntry[] }>(res);
    return data.entries ?? [];
  },

  get: async (slug: string): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context/${encodeURIComponent(slug)}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ entry: ContextEntry }>(res);
    return data.entry;
  },

  create: async (data: {
    slug?: string;
    name?: string;
    body: string;
    agent: string[];
    actorLogin?: string;
  }): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ entry: ContextEntry }>(res);
    return payload.entry;
  },

  update: async (
    slug: string,
    data: {
      body?: string;
      agent?: string[];
      actorLogin?: string;
    },
  ): Promise<ContextEntry> => {
    const res = await fetch(`${API_BASE}/context/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(data),
    });
    const payload = await handleResponse<{ entry: ContextEntry }>(res);
    return payload.entry;
  },

  remove: async (slug: string, actorLogin?: string): Promise<void> => {
    const params = new URLSearchParams();
    if (actorLogin) params.set("actorLogin", actorLogin);
    const suffix = params.toString() ? `?${params}` : "";
    const res = await fetch(
      `${API_BASE}/context/${encodeURIComponent(slug)}${suffix}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      },
    );
    await handleResponse<{ success: boolean }>(res);
  },
};
