import { describe, expect, it } from "vitest";
import {
  RECONCILIATION_RETRY_MS,
  RECONCILIATION_VERSION,
  getReconciliationScope,
  getWebhookReconciliationNotice,
  isAutomaticReconciliationOrigin,
  shouldReconcileWebhook,
  type WebhookReconciliationRecord,
} from "../../src/dashboard/lib/webhooks/reconciliation";

describe("webhook reconciliation policy", () => {
  const now = 1_000_000;

  it("reconciles a repository that has never been checked", () => {
    expect(
      shouldReconcileWebhook(undefined, {
        scope: "acme/service",
        now,
      }),
    ).toBe(true);
  });

  it("does not retry a successful repository on every page load", () => {
    const record: WebhookReconciliationRecord = {
      version: RECONCILIATION_VERSION,
      scope: "acme/service",
      status: "ok",
      attemptedAt: now - 1,
    };

    expect(shouldReconcileWebhook(record, { scope: "acme/service", now })).toBe(
      false,
    );
  });

  it("retries a failed repository only after the cooldown", () => {
    const record: WebhookReconciliationRecord = {
      version: RECONCILIATION_VERSION,
      scope: "acme/service",
      status: "failed",
      attemptedAt: now - RECONCILIATION_RETRY_MS,
    };

    expect(shouldReconcileWebhook(record, { scope: "acme/service", now })).toBe(
      true,
    );
    expect(
      shouldReconcileWebhook(
        { ...record, attemptedAt: now - RECONCILIATION_RETRY_MS + 1 },
        { scope: "acme/service", now },
      ),
    ).toBe(false);
  });

  it("invalidates records when the repository or policy version changes", () => {
    const record: WebhookReconciliationRecord = {
      version: RECONCILIATION_VERSION,
      scope: "acme/service",
      status: "ok",
      attemptedAt: now,
    };

    expect(shouldReconcileWebhook(record, { scope: "acme/other", now })).toBe(
      true,
    );
    expect(
      shouldReconcileWebhook(
        { ...record, version: "older" },
        { scope: "acme/service", now },
      ),
    ).toBe(true);
  });

  it("normalizes repository scopes for stable storage keys", () => {
    expect(getReconciliationScope(" Acme ", " Service ")).toBe("acme/service");
  });

  it("only enables automatic repair on the configured public origin", () => {
    expect(
      isAutomaticReconciliationOrigin(
        "https://kody.example.com",
        "https://kody.example.com/",
      ),
    ).toBe(true);
    expect(
      isAutomaticReconciliationOrigin(
        "https://preview-kody.vercel.app",
        "https://kody.example.com",
      ),
    ).toBe(false);
    expect(isAutomaticReconciliationOrigin("http://localhost:3333", "")).toBe(
      false,
    );
    expect(
      isAutomaticReconciliationOrigin("https://kody.example.com", ""),
    ).toBe(true);
  });

  it("explains missing GitHub webhook permission without claiming the hook is broken", () => {
    expect(
      getWebhookReconciliationNotice(
        { error: "list hooks failed", status: 404 },
        "acme/service",
      ),
    ).toEqual({
      title: "GitHub webhook permission required",
      description:
        "The connected GitHub token cannot manage webhooks for acme/service. Give it repository access and Webhooks read and write permission, then reconnect the repository. Kody will keep checking for updates meanwhile.",
    });
  });

  it("does not show an error when automatic registration is intentionally skipped", () => {
    expect(
      getWebhookReconciliationNotice(
        { error: "preview_environment", skipped: true },
        "acme/service",
      ),
    ).toBeUndefined();
  });

  it("describes an unknown failure as a check failure, not a broken webhook", () => {
    expect(getWebhookReconciliationNotice({}, "acme/service")).toEqual({
      title: "GitHub webhook check failed",
      description:
        "Kody could not check webhook access for acme/service. Existing webhook deliveries may still work; Kody will retry automatically and keep checking for updates.",
    });
  });
});
