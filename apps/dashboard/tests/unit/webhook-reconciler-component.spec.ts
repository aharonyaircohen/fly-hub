import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentSource = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/webhooks/WebhookRegistrationReconciler.tsx",
  ),
  "utf8",
);
const providerSource = readFileSync(
  resolve(__dirname, "../../app/KodyProviders.tsx"),
  "utf8",
);
const clientSource = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/webhooks/reconciliation-client.ts",
  ),
  "utf8",
);

describe("webhook registration reconciler", () => {
  it("uses the active repository and the existing registration endpoint", () => {
    expect(componentSource).toMatch(/resolveActiveRepo/);
    expect(clientSource).toMatch(/\/api\/webhooks\/register/);
    expect(clientSource).toMatch(/x-kody-token/);
    expect(clientSource).toMatch(/x-kody-owner/);
    expect(clientSource).toMatch(/x-kody-repo/);
    expect(clientSource).toMatch(/x-kody-webhook-reconcile/);
  });

  it("is mounted once at the provider boundary", () => {
    expect(providerSource).toMatch(/<WebhookRegistrationReconciler\s*\/>/);
  });

  it("does not reconcile on every render", () => {
    expect(componentSource).toMatch(/shouldReconcileWebhook/);
    expect(componentSource).toMatch(/readReconciliationRecord/);
    expect(componentSource).not.toMatch(/localStorage/);
  });

  it("uses the shared notice policy instead of claiming the webhook is broken", () => {
    expect(componentSource).toMatch(/getWebhookReconciliationNotice/);
    expect(componentSource).not.toMatch(/until it is repaired/);
  });
});
