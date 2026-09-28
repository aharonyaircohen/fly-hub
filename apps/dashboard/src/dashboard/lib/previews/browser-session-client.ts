import { buildHeaders } from "@dashboard/lib/api";
import type { PreviewEditCommand } from "@dashboard/lib/picker/protocol";
import type { BrowserPageState } from "./browser-controller-state";

export type BrowserViewport = { width: number; height: number };

export type BrowserSessionStatus =
  | { mode: "iframe"; reason: string }
  | { mode: "remote"; state: "idle" }
  | {
      mode: "remote";
      sessionId: string;
      state: "starting" | "running" | "suspended" | "failed";
      currentUrl: string;
      viewport: BrowserViewport;
      streamUrl: string;
      directUrl: string;
      uploadUrl: string;
      ticketExpiresAt: number;
    };

export type RemoteBrowserAction =
  | { type: "navigate"; url: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "viewport"; width: number; height: number }
  | { type: "screenshot" }
  | { type: "snapshot" }
  | { type: "click"; selector: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "scroll"; selector?: string; deltaY: number }
  | { type: "wait"; ms: number }
  | {
      type: "upload";
      selector: string;
      uploadId: string;
      allowedOrigins: string[];
      capabilitySlug: string;
    }
  | { type: "pick" }
  | { type: "pickResult" }
  | { type: "cancelPick" }
  | { type: "perf" }
  | { type: "edit"; command: PreviewEditCommand }
  | { type: "undoEdit" }
  | { type: "resetEdits"; selector?: string }
  | { type: "recordStart" }
  | { type: "recordStop" };

export type BrowserSessionAction =
  | Exclude<RemoteBrowserAction, { type: "upload" }>
  | {
      type: "upload";
      selector: string;
      paths: string[];
      allowedOrigins: string[];
      capabilitySlug: string;
    };

export interface BrowserUploadFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

const ALLOWED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_FILE_BYTES = 100 * 1024 * 1024;

export function browserUploadEndpoint(streamUrl: string): string {
  const url = new URL(streamUrl);
  url.protocol = "https:";
  url.pathname = "/upload";
  return url.toString();
}

export function browserUploadMimeType(name: string): string | null {
  const extension = name.toLowerCase().split(".").pop();
  return (
    {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
    }[extension ?? ""] ?? null
  );
}

export async function stageBrowserUpload(input: {
  uploadUrl: string;
  uploadId: string;
  files: BrowserUploadFile[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.files.length || input.files.length > MAX_UPLOAD_FILES) {
    throw new Error("browser_upload_file_count_invalid");
  }
  const request = input.fetchImpl ?? fetch;
  for (const [index, file] of input.files.entries()) {
    if (
      !ALLOWED_UPLOAD_TYPES.has(file.mimeType) ||
      browserUploadMimeType(file.name) !== file.mimeType
    ) {
      throw new Error("browser_upload_type_not_allowed");
    }
    if (
      !file.bytes.byteLength ||
      file.bytes.byteLength > MAX_UPLOAD_FILE_BYTES
    ) {
      throw new Error("browser_upload_size_invalid");
    }
    const url = new URL(input.uploadUrl);
    url.searchParams.set("uploadId", input.uploadId);
    url.searchParams.set("index", String(index));
    url.searchParams.set("name", file.name);
    url.searchParams.set("mimeType", file.mimeType);
    const response = await request(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(file.bytes).buffer,
    });
    if (!response.ok) throw new Error(`browser_upload_${response.status}`);
  }
}

export interface RemoteBrowserActionResult {
  ok: boolean;
  url?: string;
  title?: string;
  page?: BrowserPageState;
  data?: unknown;
  error?: string;
}

async function readResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? `browser_api_${response.status}`);
  return data;
}

export async function fetchBrowserSession(
  actorLogin: string,
): Promise<BrowserSessionStatus> {
  const response = await fetch(
    `/api/kody/browser/session?actorLogin=${encodeURIComponent(actorLogin)}`,
    { headers: buildHeaders(), cache: "no-store" },
  );
  return await readResponse<BrowserSessionStatus>(response);
}

export async function startBrowserSession(
  actorLogin: string,
  initialUrl: string,
): Promise<BrowserSessionStatus> {
  const response = await fetch("/api/kody/browser/session", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ operation: "start", actorLogin, initialUrl }),
  });
  return await readResponse(response);
}

export async function resumeBrowserSession(
  actorLogin: string,
  sessionId: string,
): Promise<BrowserSessionStatus> {
  const response = await fetch("/api/kody/browser/session", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ operation: "resume", actorLogin, sessionId }),
  });
  return await readResponse(response);
}

export async function actInBrowserSession(
  actorLogin: string,
  sessionId: string,
  action: RemoteBrowserAction,
): Promise<RemoteBrowserActionResult> {
  const response = await fetch("/api/kody/browser/session", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ operation: "act", actorLogin, sessionId, action }),
  });
  return await readResponse(response);
}

export async function closeBrowserSession(
  actorLogin: string,
  sessionId: string,
): Promise<void> {
  const response = await fetch("/api/kody/browser/session", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ operation: "close", actorLogin, sessionId }),
  });
  await readResponse(response);
}
