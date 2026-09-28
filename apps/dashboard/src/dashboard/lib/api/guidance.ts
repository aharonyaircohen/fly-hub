import { API_BASE, buildHeaders, handleResponse } from "./client";

export type GuidanceKind = "context" | "constraints" | "intents" | "policies";

export interface GuidanceEntry {
  slug: string;
  body: string;
  agent: string[];
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

export function createGuidanceApi(kind: GuidanceKind) {
  const base = `${API_BASE}/${kind}`;
  return {
    async list(): Promise<GuidanceEntry[]> {
      const response = await fetch(base, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      return (
        (await handleResponse<{ entries: GuidanceEntry[] }>(response))
          .entries ?? []
      );
    },
    async get(slug: string): Promise<GuidanceEntry> {
      const response = await fetch(`${base}/${encodeURIComponent(slug)}`, {
        headers: buildHeaders(),
      });
      return (await handleResponse<{ entry: GuidanceEntry }>(response)).entry;
    },
    async create(data: { slug: string; body: string; agent: string[] }) {
      const response = await fetch(base, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      });
      return (await handleResponse<{ entry: GuidanceEntry }>(response)).entry;
    },
    async update(slug: string, data: { body?: string; agent?: string[] }) {
      const response = await fetch(`${base}/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(data),
      });
      return (await handleResponse<{ entry: GuidanceEntry }>(response)).entry;
    },
    async remove(slug: string): Promise<void> {
      const response = await fetch(`${base}/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: buildHeaders(),
      });
      await handleResponse<{ success: boolean }>(response);
    },
  };
}
