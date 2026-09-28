import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  mutations: [] as Array<{ op: string; args: Record<string, unknown> }>,
}));
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    appDeployments: { get: "deployments.get", update: "deployments.update" },
    apps: {
      getById: "apps.getById",
      transition: "apps.transition",
      endAction: "apps.endAction",
    },
    appEvents: { append: "events.append" },
    inbox: { upsert: "inbox.upsert" },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => ({
    query: async (op: string) =>
      op === "deployments.get"
        ? {
            requestId: "11111111-1111-4111-8111-111111111111",
            callbackTokenHash: crypto
              .createHash("sha256")
              .update("callback-secret")
              .digest("hex"),
          }
        : { name: "Web", slug: "web", createdBy: "alice" },
    mutation: async (op: string, args: Record<string, unknown>) => {
      state.mutations.push({ op, args });
    },
  }),
}));
import { POST } from "../../app/api/kody/apps/events/route";
const body = {
  tenantId: "acme/web",
  appId: "22222222-2222-4222-8222-222222222222",
  deploymentId: "33333333-3333-4333-8333-333333333333",
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "running",
};
const request = (token?: string, status = body.status) =>
  new NextRequest("https://dashboard.test/api/kody/apps/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...body, status }),
  });
describe("App builder events", () => {
  beforeEach(() => (state.mutations = []));
  it("rejects an invalid callback without writes", async () => {
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(state.mutations).toHaveLength(0);
  });
  it("durably completes the deployment and notifies Inbox", async () => {
    const response = await POST(request("callback-secret"));
    expect(response.status).toBe(200);
    expect(state.mutations.map((item) => item.op)).toEqual([
      "deployments.update",
      "apps.transition",
      "apps.endAction",
      "events.append",
      "inbox.upsert",
    ]);
    expect(state.mutations.at(-1)?.args).toMatchObject({ login: "alice" });
  });
  it("records verification without completing the deployment action", async () => {
    const response = await POST(request("callback-secret", "verifying"));
    expect(response.status).toBe(200);
    expect(state.mutations.map((item) => item.op)).toEqual([
      "deployments.update",
      "events.append",
    ]);
    expect(state.mutations[0]?.args).toMatchObject({ status: "verifying" });
  });
});
