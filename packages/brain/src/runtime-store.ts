/**
 * @fileType service
 * @domain brain
 * @pattern brain-runtime-store
 *
 * Durable per-user Brain runtime state. This is separate from the saved image
 * catalog: image selection is desired state, while `running` is the actual
 * Fly runtime the terminal may connect to.
 */
import "server-only";

import { isValidBrainImageRef } from "./store";
import { getPersonalBrainServices } from "./personal-services";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
  data: BrainRuntimeStateFile | null;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(login: string): string {
  return `brain-runtime:${login.toLowerCase()}`;
}

function getCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(
  key: string,
  data: BrainRuntimeStateFile | null,
  etag?: string,
): void {
  cache.set(key, { data, etag, expires: Date.now() + CACHE_TTL_MS });
}

export function _resetBrainRuntimeCache(): void {
  cache.clear();
}

export interface BrainRuntimeRunning {
  imageRef: string;
  app: string;
  machineId: string;
  orgSlug: string;
  url?: string;
  appliedAt: string;
}

export type BrainRuntimeStage =
  | "validating"
  | "resolving-image"
  | "resolving-service"
  | "provisioning"
  | "installing-agent-access"
  | "preparing-runtime-image"
  | "verifying-health"
  | "recording-runtime"
  | "recovering-previous";

const BRAIN_RUNTIME_STAGES = new Set<BrainRuntimeStage>([
  "validating",
  "resolving-image",
  "resolving-service",
  "provisioning",
  "installing-agent-access",
  "preparing-runtime-image",
  "verifying-health",
  "recording-runtime",
  "recovering-previous",
]);

export interface BrainRuntimeOperation {
  id: string;
  type: "apply-image" | "save-image";
  status: "running" | "completed" | "failed";
  imageRef: string;
  startedAt: string;
  updatedAt: string;
  stage?: BrainRuntimeStage;
  attempt?: number;
  error?: string;
  recoveredImageRef?: string;
}

export interface BrainRuntimeStateFile {
  version: 1;
  desiredImageRef?: string;
  running?: BrainRuntimeRunning;
  operation?: BrainRuntimeOperation;
  updatedAt: string;
}

function isRuntimeRunning(value: unknown): value is BrainRuntimeRunning {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.app === "string" &&
    v.app.length > 0 &&
    typeof v.machineId === "string" &&
    v.machineId.length > 0 &&
    typeof v.orgSlug === "string" &&
    v.orgSlug.length > 0 &&
    (v.url === undefined || typeof v.url === "string") &&
    typeof v.appliedAt === "string"
  );
}

function isRuntimeOperation(value: unknown): value is BrainRuntimeOperation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    (v.type === "apply-image" || v.type === "save-image") &&
    (v.status === "running" ||
      v.status === "completed" ||
      v.status === "failed") &&
    typeof v.imageRef === "string" &&
    isValidBrainImageRef(v.imageRef) &&
    typeof v.startedAt === "string" &&
    typeof v.updatedAt === "string" &&
    (v.stage === undefined || BRAIN_RUNTIME_STAGES.has(v.stage as BrainRuntimeStage)) &&
    (v.attempt === undefined ||
      (typeof v.attempt === "number" && Number.isInteger(v.attempt) && v.attempt > 0)) &&
    (v.error === undefined || typeof v.error === "string") &&
    (v.recoveredImageRef === undefined ||
      typeof v.recoveredImageRef === "string")
  );
}

function normalizeRuntimeState(
  value: unknown,
  opts: { forWrite?: boolean } = {},
): BrainRuntimeStateFile | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.updatedAt !== "string") return null;
  if (
    typeof v.desiredImageRef === "string" &&
    !isValidBrainImageRef(v.desiredImageRef)
  ) {
    return null;
  }
  const desiredImageRef =
    typeof v.desiredImageRef === "string" ? v.desiredImageRef : undefined;
  const running = isRuntimeRunning(v.running) ? v.running : undefined;
  const operation = isRuntimeOperation(v.operation) ? v.operation : undefined;
  if (
    opts.forWrite &&
    operation?.type === "apply-image" &&
    operation.status === "completed" &&
    !running
  ) {
    return null;
  }
  return {
    version: 1,
    ...(desiredImageRef ? { desiredImageRef } : {}),
    ...(running ? { running } : {}),
    ...(operation ? { operation } : {}),
    updatedAt: v.updatedAt,
  };
}

export async function readBrainRuntimeState(
  login: string,
  _token: string,
  fresh = false,
): Promise<BrainRuntimeStateFile | null> {
  const key = cacheKey(login);
  const cached = getCache(key);
  if (cached && !fresh) return cached.data;
  const services = getPersonalBrainServices();
  const user = await services.resolveUser();
  if (!user) return null;
  const parsed = normalizeRuntimeState(
    await services.loadState(user.id, "runtime"),
  );
  setCache(key, parsed);
  return parsed;
}

export async function writeBrainRuntimeState(
  login: string,
  _token: string,
  file: BrainRuntimeStateFile,
  expectedDataUpdatedAt?: string | null,
): Promise<void> {
  const normalized = normalizeRuntimeState(file, { forWrite: true });
  if (!normalized) {
    throw new Error("Invalid Brain runtime state");
  }
  const key = cacheKey(login);
  cache.delete(key);
  const services = getPersonalBrainServices();
  const user = await services.resolveUser();
  if (!user) throw new Error("unauthorized");
  if (expectedDataUpdatedAt === undefined) {
    await services.saveState(user.id, "runtime", normalized);
  } else {
    await services.saveState(
      user.id,
      "runtime",
      normalized,
      expectedDataUpdatedAt,
    );
  }
  setCache(key, normalized);
}
