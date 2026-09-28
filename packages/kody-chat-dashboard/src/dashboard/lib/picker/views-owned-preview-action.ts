import {
  isPreviewActDirective,
  type PreviewActDirective,
} from "../chat-ui-actions";
import type { PreviewAction } from "./protocol";

const PENDING_ACTION_KEY = "kody:views:pending-capability-action";
const PENDING_ACTION_TTL_MS = 120_000;

interface ActionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

export function stagePendingViewsCapabilityAction(
  directive: PreviewActDirective,
  storage: ActionStorage,
  nowMs = Date.now(),
): void {
  storage.setItem(
    PENDING_ACTION_KEY,
    JSON.stringify({ version: 1, queuedAt: nowMs, directive }),
  );
}

export function consumePendingViewsCapabilityAction(
  storage: ActionStorage,
  nowMs = Date.now(),
): PreviewActDirective | null {
  const raw = storage.getItem(PENDING_ACTION_KEY);
  storage.removeItem(PENDING_ACTION_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as {
      version?: unknown;
      queuedAt?: unknown;
      directive?: unknown;
    };
    if (
      pending.version !== 1 ||
      typeof pending.queuedAt !== "number" ||
      nowMs - pending.queuedAt > PENDING_ACTION_TTL_MS ||
      nowMs < pending.queuedAt ||
      !isPreviewActDirective(pending.directive)
    ) {
      return null;
    }
    return pending.directive;
  } catch {
    return null;
  }
}

export function isViewsPath(pathname: string | null): boolean {
  return /(?:^|\/)preview(?:\/|$)/.test(pathname ?? "");
}

export function isSelectedViewPath(pathname: string | null): boolean {
  return /(?:^|\/)preview\/[^/]+(?:\/|$)/.test(pathname ?? "");
}

export async function ensureViewsOwnedCapabilityAction(input: {
  action: PreviewAction;
  pathname: string | null;
  openViews: () => void;
  remoteBrowserAvailable: () => boolean;
  wait?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<boolean> {
  if (!input.action.capabilitySlug) return true;

  if (!isViewsPath(input.pathname)) input.openViews();

  const wait =
    input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = input.maxAttempts ?? 240;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (input.remoteBrowserAvailable()) return true;
    await wait(250);
  }
  return false;
}
