import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const issuedAt = "2026-09-02T08:00:00.000Z";
const token = {
  tokenId: "mcp-token-1",
  tokenHash: "hash-1",
  name: "Claude Code",
  tenantId: "acme/widgets",
  actorLogin: "octocat",
  actorGithubId: 42,
  scopes: ["mcp:read", "mcp:execute"],
  createdAt: issuedAt,
  expiresAt: "2026-10-02T08:00:00.000Z",
};

describe("MCP access tokens", () => {
  it("authenticates an active scoped token without returning its hash", async () => {
    const t = setup();
    await t.mutation(api.mcpAccessTokens.create, token);

    await expect(
      t.query(api.mcpAccessTokens.authenticate, {
        tokenHash: token.tokenHash,
        now: "2026-09-03T08:00:00.000Z",
      }),
    ).resolves.toEqual({
      tokenId: token.tokenId,
      name: token.name,
      tenantId: token.tenantId,
      actorLogin: token.actorLogin,
      actorGithubId: token.actorGithubId,
      scopes: token.scopes,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    });
  });

  it("rejects expired and revoked tokens", async () => {
    const t = setup();
    await t.mutation(api.mcpAccessTokens.create, token);
    await expect(
      t.query(api.mcpAccessTokens.authenticate, {
        tokenHash: token.tokenHash,
        now: "2026-11-02T08:00:00.000Z",
      }),
    ).resolves.toBeNull();

    await t.mutation(api.mcpAccessTokens.revoke, {
      tenantId: token.tenantId,
      actorLogin: token.actorLogin,
      tokenId: token.tokenId,
      revokedAt: "2026-09-04T08:00:00.000Z",
    });
    await expect(
      t.query(api.mcpAccessTokens.authenticate, {
        tokenHash: token.tokenHash,
        now: "2026-09-05T08:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("lists only the caller's repository tokens and never exposes hashes", async () => {
    const t = setup();
    await t.mutation(api.mcpAccessTokens.create, token);
    await t.mutation(api.mcpAccessTokens.create, {
      ...token,
      tokenId: "other-token",
      tokenHash: "other-hash",
      tenantId: "other/repository",
    });

    const rows = await t.query(api.mcpAccessTokens.list, {
      tenantId: token.tenantId,
      actorLogin: token.actorLogin,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("tokenHash");
  });
});

describe("MCP request controls", () => {
  it("enforces a durable request limit and records scoped audit events", async () => {
    const t = setup();
    await expect(
      t.mutation(api.mcpRateLimits.check, {
        key: token.tokenId,
        now: 1_000,
        windowSec: 60,
        limit: 1,
      }),
    ).resolves.toBe(true);
    await expect(
      t.mutation(api.mcpRateLimits.check, {
        key: token.tokenId,
        now: 1_001,
        windowSec: 60,
        limit: 1,
      }),
    ).resolves.toBe(false);

    await t.mutation(api.mcpAuditEvents.append, {
      eventId: "evt-1",
      tenantId: token.tenantId,
      tokenId: token.tokenId,
      actorLogin: token.actorLogin,
      method: "tools/call",
      toolName: "kody_execute_tool",
      actionId: "repository.scope.get",
      outcome: "success",
      occurredAt: issuedAt,
    });
    await expect(
      t.query(api.mcpAuditEvents.list, {
        tenantId: token.tenantId,
        limit: 10,
      }),
    ).resolves.toMatchObject([
      {
        eventId: "evt-1",
        actionId: "repository.scope.get",
        outcome: "success",
      },
    ]);
  });
});
