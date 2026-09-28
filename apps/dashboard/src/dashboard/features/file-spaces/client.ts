import type { KodyAuth } from "@dashboard/lib/auth-context";
import { buildAuthHeaders } from "@dashboard/lib/auth-context";
import type { FileSpace } from "./model";

async function request<T>(auth: KodyAuth, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/kody/file-spaces", {
    ...init,
    headers: {
      ...buildAuthHeaders(auth),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "File spaces request failed");
  return body;
}

export function fetchFileSpaces(auth: KodyAuth): Promise<{ spaces: FileSpace[] }> {
  return request(auth);
}

export function createFileSpaceRequest(auth: KodyAuth, title: string) {
  return request<{ space: FileSpace }>(auth, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function renameFileSpaceRequest(auth: KodyAuth, id: string, title: string) {
  return request<{ space: FileSpace }>(auth, {
    method: "PATCH",
    body: JSON.stringify({ id, title }),
  });
}

export function removeFileSpaceRequest(auth: KodyAuth, id: string) {
  const query = new URLSearchParams({ id });
  return fetch(`/api/kody/file-spaces?${query}`, {
    method: "DELETE",
    headers: buildAuthHeaders(auth),
  }).then(async (response) => {
    const body = (await response.json().catch(() => ({}))) as {
      ok?: true;
      message?: string;
    };
    if (!response.ok) throw new Error(body.message ?? "Failed to remove file space");
    return body as { ok: true };
  });
}

export function reorderFileSpacesRequest(auth: KodyAuth, ids: string[]) {
  return request<{ spaces: FileSpace[] }>(auth, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}
