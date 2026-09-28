import type { ActiveRepo } from "@kody-ade/base/active-repo";
import {
  RECONCILIATION_VERSION,
  type WebhookReconciliationRecord,
} from "./reconciliation";

const STORAGE_PREFIX = "kody:webhook-reconciliation:";

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

export function readReconciliationRecord(
  scope: string,
): WebhookReconciliationRecord | undefined {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<WebhookReconciliationRecord>;
    if (
      typeof parsed.version !== "string" ||
      typeof parsed.scope !== "string" ||
      (parsed.status !== "ok" && parsed.status !== "failed") ||
      typeof parsed.attemptedAt !== "number"
    ) {
      return undefined;
    }
    return parsed as WebhookReconciliationRecord;
  } catch {
    return undefined;
  }
}

export function writeReconciliationRecord(
  record: WebhookReconciliationRecord,
): void {
  try {
    localStorage.setItem(storageKey(record.scope), JSON.stringify(record));
  } catch {
    // Storage policy must never prevent the dashboard from loading.
  }
}

export type WebhookRegistrationResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  status?: number;
  skipped?: boolean;
};

export async function registerActiveWebhook(
  activeRepo: ActiveRepo,
): Promise<WebhookRegistrationResponse> {
  const response = await fetch("/api/webhooks/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kody-webhook-reconcile": "automatic",
      "x-kody-token": activeRepo.token,
      "x-kody-owner": activeRepo.owner,
      "x-kody-repo": activeRepo.repo,
    },
    body: JSON.stringify({
      owner: activeRepo.owner,
      repo: activeRepo.repo,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    message?: string;
    status?: number;
    skipped?: boolean;
  };

  return {
    ok: response.ok && body.ok === true,
    error: body.error,
    message: body.message,
    status: body.status,
    skipped: body.skipped,
  };
}

export function failedReconciliationRecord(
  scope: string,
  attemptedAt: number,
): WebhookReconciliationRecord {
  return {
    version: RECONCILIATION_VERSION,
    scope,
    status: "failed",
    attemptedAt,
  };
}

export function successfulReconciliationRecord(
  scope: string,
  attemptedAt: number,
): WebhookReconciliationRecord {
  return {
    version: RECONCILIATION_VERSION,
    scope,
    status: "ok",
    attemptedAt,
  };
}
