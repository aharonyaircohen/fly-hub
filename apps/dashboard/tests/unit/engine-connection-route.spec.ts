import { beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  verify: vi.fn(),
}));
const backend = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@dashboard/lib/backend/github-actions-identity", () => ({
  bearerToken: (request: Request) => request.headers.get("authorization")?.replace("Bearer ", "") ?? null,
  verifyGitHubWorkflowIdentity: identity.verify,
}));
vi.mock("@kody-ade/backend/client", () => ({ createBackendClient: () => backend }));

import { POST } from "../../app/api/kody/engine/connection/route";

const request = (id = "facebook-main", token = "oidc") =>
  new Request("http://localhost/api/kody/engine/connection", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  identity.verify.mockResolvedValue({ repository: "acme/studio", actor: "github-actions" });
  backend.query.mockResolvedValue({
    id: "facebook-main",
    name: "Yair Facebook Page",
    provider: "facebook",
    accountType: "page",
    externalId: "123456789",
    credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
    status: "connected",
    verifiedAt: "2026-08-31T12:00:00.000Z",
  });
});

describe("Engine Connection API", () => {
  it("scopes a Connection read to the OIDC repository", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/studio",
      connectionId: "facebook-main",
    });
    expect(JSON.stringify(await response.json())).not.toContain("secret-value");
  });

  it("rejects invalid workflow identity and Connection ids", async () => {
    identity.verify.mockRejectedValueOnce(new Error("invalid"));
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("Facebook Main"))).status).toBe(400);
  });
});
