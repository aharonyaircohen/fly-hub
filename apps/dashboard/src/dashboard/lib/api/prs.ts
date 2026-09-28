import type { FileChange, PRComment, ActionResponse } from "@kody-ade/base/types";
import {
  API_BASE,
  buildHeaders,
  handleResponse,
  getStoredAuth,
  NoTokenError,
} from "./client";

// ============ PRs API ============

export const prsApi = {
  files: async (prNumber: number): Promise<FileChange[]> => {
    const res = await fetch(`${API_BASE}/prs/files?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ files: FileChange[] }>(res);
    return data.files;
  },
  // PR CI status is sourced from the bulk tasks list — see usePRCIStatus.
  behind: async (prNumber: number): Promise<number> => {
    const res = await fetch(`${API_BASE}/prs/behind?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ behindBy: number }>(res);
    return data.behindBy;
  },
  comments: async (prNumber: number): Promise<PRComment[]> => {
    const res = await fetch(`${API_BASE}/prs/comments?prNumber=${prNumber}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ comments: PRComment[] }>(res);
    return data.comments;
  },
  // Resolves a PR's preview URL on-demand (so the pane doesn't wait for the
  // background tasks poll). Fly-first when `pr` is given and the repo builds
  // previews on Fly; otherwise the server falls back to the Vercel deployment
  // for `sha`.
  preview: async (sha: string, pr?: number): Promise<string | null> => {
    const qs = pr ? `?sha=${sha}&pr=${pr}` : `?sha=${sha}`;
    const res = await fetch(`${API_BASE}/prs/preview${qs}`, {
      headers: buildHeaders(),
    });
    const data = await handleResponse<{ previewUrl: string | null }>(res);
    return data.previewUrl;
  },
  createPreview: async (
    prNumber: number,
    ref: string,
  ): Promise<{
    url: string | null;
    state: string;
    builderMachineId?: string;
  }> => {
    const auth = getStoredAuth();
    if (!auth) throw new NoTokenError();
    const res = await fetch(`${API_BASE}/previews`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        repo: `${auth.owner}/${auth.repo}`,
        pr: prNumber,
        ref,
      }),
    });
    return handleResponse(res);
  },
  wakePreview: async (
    prNumber: number,
  ): Promise<{
    url: string | null;
    state: string;
    machineId?: string;
  }> => {
    const auth = getStoredAuth();
    if (!auth) throw new NoTokenError();
    const owner = encodeURIComponent(auth.owner);
    const repo = encodeURIComponent(auth.repo);
    const res = await fetch(
      `${API_BASE}/previews/${owner}/${repo}/${prNumber}`,
      {
        method: "POST",
        headers: buildHeaders(),
      },
    );
    const data = await handleResponse<{
      ok: true;
      preview: { url: string | null; state: string; machineId?: string };
    }>(res);
    return data.preview;
  },
  postComment: async (
    prNumber: number,
    body: string,
    actorLogin?: string,
  ): Promise<ActionResponse> => {
    const res = await fetch(`${API_BASE}/prs/comments`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        prNumber,
        body,
        ...(actorLogin && { actorLogin }),
      }),
    });
    return handleResponse(res);
  },
};
