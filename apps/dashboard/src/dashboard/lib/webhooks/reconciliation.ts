/**
 * Browser-side policy for bounded webhook reconciliation.
 *
 * The registrar remains server-owned. This module only decides when the
 * client may ask the registrar to repair the active repository, so auth and
 * GitHub API concerns do not leak into each other.
 */

export const RECONCILIATION_VERSION = "v2";
export const RECONCILIATION_RETRY_MS = 60 * 60 * 1000;

export type WebhookReconciliationRecord = {
  version: string;
  scope: string;
  status: "ok" | "failed";
  attemptedAt: number;
};

export type WebhookReconciliationFailure = {
  error?: string;
  status?: number;
  skipped?: boolean;
};

export type WebhookReconciliationNotice = {
  title: string;
  description: string;
};

export function getWebhookReconciliationNotice(
  failure: WebhookReconciliationFailure,
  repository: string,
): WebhookReconciliationNotice | undefined {
  if (
    failure.skipped ||
    failure.error === "public_url_required" ||
    failure.error === "preview_environment"
  ) {
    return undefined;
  }

  if (failure.status === 403 || failure.status === 404) {
    return {
      title: "GitHub webhook permission required",
      description: `The connected GitHub token cannot manage webhooks for ${repository}. Give it repository access and Webhooks read and write permission, then reconnect the repository. Kody will keep checking for updates meanwhile.`,
    };
  }

  return {
    title: "GitHub webhook check failed",
    description: `Kody could not check webhook access for ${repository}. Existing webhook deliveries may still work; Kody will retry automatically and keep checking for updates.`,
  };
}

export function getReconciliationScope(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

export function isAutomaticReconciliationOrigin(
  currentOrigin: string,
  configuredPublicUrl: string,
): boolean {
  try {
    const current = new URL(currentOrigin);
    if (!configuredPublicUrl.trim()) {
      return current.protocol === "https:" && current.hostname !== "localhost";
    }
    const configured = new URL(configuredPublicUrl);
    return (
      configured.protocol === "https:" && configured.origin === current.origin
    );
  } catch {
    return false;
  }
}

export function shouldReconcileWebhook(
  record: WebhookReconciliationRecord | undefined,
  input: { scope: string; now: number },
): boolean {
  if (!record) return true;
  if (record.version !== RECONCILIATION_VERSION) return true;
  if (record.scope !== input.scope) return true;
  if (record.status === "ok") return false;
  return input.now - record.attemptedAt >= RECONCILIATION_RETRY_MS;
}
