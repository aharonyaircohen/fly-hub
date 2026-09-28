import { API_BASE, buildHeaders, handleResponse } from "./client";

// ============ Company import/export API ============

import type {
  CompanyBundle,
  CompanyImportMode,
  CompanyImportResult,
} from "../company/types";

export const companyApi = {
  decidePipeline: async (input: {
    pipelineId: string;
    runId: string;
    decision: "approve" | "reject";
  }): Promise<"approved" | "rejected"> => {
    const res = await fetch(
      `${API_BASE}/company/pipelines/${encodeURIComponent(input.pipelineId)}/runs/${encodeURIComponent(input.runId)}/decision`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ decision: input.decision }),
      },
    );
    const data = await handleResponse<{
      ok: true;
      status: "approved" | "rejected";
    }>(res);
    return data.status;
  },
  /** Export the connected repo's agent/capabilities/prompts/instructions bundle. */
  export: async (): Promise<CompanyBundle> => {
    const res = await fetch(`${API_BASE}/company`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    const data = await handleResponse<{ bundle: CompanyBundle }>(res);
    return data.bundle;
  },

  /** Apply an uploaded bundle to the connected repo. */
  import: async (
    bundle: CompanyBundle,
    mode: CompanyImportMode,
    actorLogin?: string,
  ): Promise<CompanyImportResult> => {
    const res = await fetch(`${API_BASE}/company`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ bundle, mode, ...(actorLogin && { actorLogin }) }),
    });
    const data = await handleResponse<{ result: CompanyImportResult }>(res);
    return data.result;
  },

  /** The operator list (`github.operators`) — who recommendation capabilities
   * @-mention so their comments land in the inbox. */
  operators: {
    get: async (): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/company/operators`, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      const data = await handleResponse<{ operators: string[] }>(res);
      return data.operators;
    },
    set: async (
      operators: string[],
      actorLogin?: string,
    ): Promise<string[]> => {
      const res = await fetch(`${API_BASE}/company/operators`, {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify({ operators, ...(actorLogin && { actorLogin }) }),
      });
      const data = await handleResponse<{ operators: string[] }>(res);
      return data.operators;
    },
  },

  /** Repo-wide engine config fields that don't have their own page:
   * quality commands, comment aliases, the `@kody` access gate, and the
   * default branch. */
  config: {
    get: async (): Promise<EngineEditableConfig> => {
      const res = await fetch(`${API_BASE}/company/config`, {
        headers: buildHeaders(),
        cache: "no-store",
      });
      return handleResponse<EngineEditableConfig>(res);
    },
    patch: async (
      patch: Partial<EngineEditableConfig>,
      actorLogin?: string,
    ): Promise<EngineEditableConfig> => {
      const res = await fetch(`${API_BASE}/company/config`, {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify({ ...patch, ...(actorLogin && { actorLogin }) }),
      });
      return handleResponse<EngineEditableConfig>(res);
    },
  },
};

/** The dashboard-editable slice of kody.config.json. */
export interface EngineEditableConfig {
  quality: {
    typecheck?: string;
    lint?: string;
    format?: string;
    testUnit?: string;
  };
  aliases: Record<string, string>;
  allowedAssociations: string[];
  activeAgents?: string[];
  activeCapabilities?: string[];
  activeCommands?: string[];
  activeWorkflows?: string[];
  activePipelines?: string[];
  state: {
    repo?: string;
    path?: string;
  } | null;
  defaultBranch: string;
  /** Thinking level for the engine (off|low|medium|high). Null = unset.
   * Loose string here — the route validates the canonical vocabulary
   * via Zod, so the client only needs the string channel. */
  reasoningEffort: string | null;
}
