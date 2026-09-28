import { beforeEach, describe, expect, it, vi } from "vitest";

const webhook = vi.hoisted(() => ({
  ensureWebhook: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/webhooks/register", () => ({
  ensureWebhook: webhook.ensureWebhook,
}));

import { createWebhookTools } from "../../app/api/kody/chat/tools/webhooks-tools";

describe("register_webhook chat tool", () => {
  beforeEach(() => {
    webhook.ensureWebhook.mockReset();
    webhook.ensureWebhook.mockResolvedValue({
      ok: true,
      hookId: 42,
      created: true,
    });
  });

  it("uses the request-derived dashboard URL without requiring an environment URL", async () => {
    const tools = createWebhookTools({
      token: "token",
      owner: "acme",
      repo: "widgets",
      hookUrl: "https://dashboard.example/api/webhooks/github",
    });

    const result = await tools.register_webhook.execute?.({}, {} as never);

    expect(result).toEqual({ ok: true, hookId: 42, created: true });
    expect(webhook.ensureWebhook).toHaveBeenCalledWith({
      token: "token",
      owner: "acme",
      repo: "widgets",
      hookUrl: "https://dashboard.example/api/webhooks/github",
    });
  });
});
