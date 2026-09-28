import {
  API_BASE,
  buildHeaders,
  handleResponse,
  type ApiAuthContext,
} from "./client";

// ============ Changelog API ============

export interface ChangelogPayload {
  content: string;
  htmlUrl: string | null;
}

export const changelogApi = {
  get: async (auth?: ApiAuthContext | null): Promise<ChangelogPayload> => {
    const res = await fetch(`${API_BASE}/changelog`, {
      headers: buildHeaders({}, auth),
    });
    return handleResponse<ChangelogPayload>(res);
  },
};
