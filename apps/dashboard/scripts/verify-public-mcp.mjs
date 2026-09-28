import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api as backendApi } from "@kody-ade/backend/api";
import {
  mapWithConcurrency,
  retryServerFailure,
} from "./verify-public-mcp-helpers.mjs";

config({ path: new URL("../.env", import.meta.url), quiet: true });

const baseUrl = process.env.KODY_MCP_TEST_BASE_URL ?? "http://127.0.0.1:3333";
const convexUrl =
  process.env.KODY_MCP_TEST_CONVEX_URL ?? process.env.CONVEX_URL;
const githubToken =
  process.env.E2E_GITHUB_TOKEN ?? process.env.GH_PAT_AGUY ?? process.env.GH_PAT;
const repository = normalizeRepository(process.env.E2E_GITHUB_REPO);
const testInstalledClients = process.argv.includes("--installed-clients");
const testPhaseTwoGates = process.argv.includes("--phase2-gates");
const testHermesClient = process.argv.includes("--hermes-client");
const testPhaseThreeGates = process.argv.includes("--phase3-gates");
const testPhaseFourGates = process.argv.includes("--phase4-gates");
const testPhaseFiveGates = process.argv.includes("--phase5-gates");

if (!githubToken || !repository) {
  throw new Error(
    "E2E_GITHUB_TOKEN and E2E_GITHUB_REPO are required for the live MCP test.",
  );
}

const [owner, repo] = repository.split("/");
const dashboardHeaders = {
  "content-type": "application/json",
  "x-kody-token": githubToken,
  "x-kody-owner": owner,
  "x-kody-repo": repo,
};

let tokenId;
let accessToken;

try {
  const issued = await jsonRequest(`${baseUrl}/api/kody/mcp/tokens`, {
    method: "POST",
    headers: dashboardHeaders,
    body: JSON.stringify({ name: "Local MCP verification", expiresInDays: 1 }),
  });
  assert.equal(issued.response.status, 201, JSON.stringify(issued.body));
  assert.match(issued.body.accessToken, /^kody_mcp_/);
  assert.equal(typeof issued.body.token?.tokenId, "string");
  accessToken = issued.body.accessToken;
  tokenId = issued.body.token.tokenId;

  for (const clientName of ["claude-code", "codex"]) {
    const initialized = await mcpRequest(accessToken, {
      jsonrpc: "2.0",
      id: `${clientName}-initialize`,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: clientName, version: "live-test" },
      },
    });
    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.body.result.protocolVersion, "2025-11-25");
  }

  const currentClient = await currentMcpRequest(accessToken, {
    jsonrpc: "2.0",
    id: "standards-client-tools",
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": {
          name: "generic-standards-client",
          version: "live-test",
        },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
  assert.equal(currentClient.response.status, 200);
  assert.equal(currentClient.body.result.resultType, "complete");
  assert.equal(currentClient.body.result.cacheScope, "private");

  const listed = await mcpRequest(accessToken, {
    jsonrpc: "2.0",
    id: "tools-list",
    method: "tools/list",
  });
  assert.deepEqual(
    listed.body.result.tools.map((tool) => tool.name),
    [
      "kody_status",
      "kody_search_tools",
      "kody_get_tool_details",
      "kody_read_tool",
      "kody_execute_tool",
    ],
  );

  const searched = await callTool(accessToken, "search", "kody_search_tools", {
    query: "scope",
  });
  assert.equal(
    searched.body.result.structuredContent.items[0].id,
    "repository.scope.get",
  );

  const detailed = await callTool(
    accessToken,
    "details",
    "kody_get_tool_details",
    { actionId: "repository.scope.get" },
  );
  assert.equal(detailed.body.result.structuredContent.permission, "read");

  const executed = await callTool(accessToken, "execute", "kody_execute_tool", {
    actionId: "repository.scope.get",
    input: {},
  });
  assert.deepEqual(executed.body.result.structuredContent, {
    repository,
    actor: issued.body.token.actorLogin,
  });

  const readTool = listed.body.result.tools.find(
    (tool) => tool.name === "kody_read_tool",
  );
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.equal(readTool.annotations.destructiveHint, false);
  const read = await callTool(accessToken, "safe-read", "kody_read_tool", {
    actionId: "repository.scope.get",
    input: {},
  });
  assert.deepEqual(
    read.body.result.structuredContent,
    executed.body.result.structuredContent,
  );
  const rejectedWrite = await callTool(
    accessToken,
    "reject-write-on-read",
    "kody_read_tool",
    {
      actionId: "work.create",
      input: {},
    },
    true,
  );
  assert.equal(
    rejectedWrite.body.result.structuredContent.error.code,
    "read_only_action_required",
  );

  const installedClients = testInstalledClients
    ? verifyInstalledClients(accessToken, repository)
    : {};
  if (testHermesClient && !testPhaseThreeGates) {
    installedClients.hermes = await verifyHermesClient();
  }
  const phaseTwoGates = testPhaseTwoGates
    ? await verifyPhaseTwoGates({
        accessToken,
        tokenId,
        actorLogin: issued.body.token.actorLogin,
        actorGithubId: issued.body.token.actorGithubId,
      })
    : undefined;
  const phaseThreeGates = testPhaseThreeGates
    ? await verifyPhaseThreeGates({
        actorLogin: issued.body.token.actorLogin,
        actorGithubId: issued.body.token.actorGithubId,
      })
    : undefined;
  const phaseFourGates = testPhaseFourGates
    ? await verifyPhaseFourGates({
        accessToken,
        actorLogin: issued.body.token.actorLogin,
        actorGithubId: issued.body.token.actorGithubId,
      })
    : undefined;
  const phaseFiveGates = testPhaseFiveGates
    ? await verifyPhaseFiveGates({
        accessToken,
        actorLogin: issued.body.token.actorLogin,
        actorGithubId: issued.body.token.actorGithubId,
      })
    : undefined;

  console.log(
    JSON.stringify({
      ok: true,
      endpoint: `${baseUrl}/api/kody/mcp`,
      repository,
      clientHandshakes: ["claude-code", "codex"],
      ...(Object.keys(installedClients).length > 0 ? { installedClients } : {}),
      ...(phaseTwoGates ? { phaseTwoGates } : {}),
      ...(phaseThreeGates ? { phaseThreeGates } : {}),
      ...(phaseFourGates ? { phaseFourGates } : {}),
      ...(phaseFiveGates ? { phaseFiveGates } : {}),
      facadeTools: listed.body.result.tools.map((tool) => tool.name),
      executedAction: "repository.scope.get",
    }),
  );
} finally {
  if (tokenId) {
    const revoked = await jsonRequestWithNetworkRetry(
      `${baseUrl}/api/kody/mcp/tokens`,
      {
        method: "DELETE",
        headers: dashboardHeaders,
        body: JSON.stringify({ tokenId }),
      },
    );
    assert.equal(
      revoked.response.status,
      200,
      "live test token revocation failed",
    );
    if (accessToken) {
      const rejected = await mcpRequest(accessToken, {
        jsonrpc: "2.0",
        id: "revoked-token-check",
        method: "ping",
      });
      assert.equal(
        rejected.response.status,
        401,
        "revoked MCP token remained active",
      );
    }
  }
}

async function verifyPhaseTwoGates(principal) {
  const listed = await jsonRequestWithNetworkRetry(
    `${baseUrl}/api/kody/mcp/tokens`,
    {
      headers: dashboardHeaders,
    },
  );
  assert.equal(listed.response.status, 200);
  assert.ok(
    listed.body.tokens.some((token) => token.tokenId === principal.tokenId),
    "issued token was absent from the scoped token list",
  );
  assert.doesNotMatch(JSON.stringify(listed.body), /tokenHash/);

  const pagedActionIds = [];
  let cursor;
  do {
    const page = await callTool(
      principal.accessToken,
      `search-page-${pagedActionIds.length}`,
      "kody_search_tools",
      { limit: 1, ...(cursor ? { cursor } : {}) },
    );
    const content = page.body.result.structuredContent;
    assert.equal(content.items.length, 1);
    pagedActionIds.push(content.items[0].id);
    cursor = content.nextCursor;
  } while (cursor);
  assert.deepEqual(pagedActionIds, [
    "repository.scope.get",
    "mcp.contract.get",
    "dashboard.features.list",
    "work.list",
    "work.get",
    "work.create",
    "work.update",
    "work.checkpoint.add",
    "work.evidence.add",
    "work.decision.add",
    "work.handoff.create",
    "work.artifact.add",
    "context.search",
    "policy.list",
    "policy.get",
    "instruction.get",
    "capability.list",
    "capability.get",
    "workflow.list",
    "workflow.get",
    "quality.gates.get",
    "approval.list",
    "approval.get",
    "workflow.run.request",
    "workflow.resume.request",
    "capability.run.request",
    "schedule.list",
    "schedule.get",
    "trigger.list",
    "trigger.get",
    "webhook.status",
    "notification.rule.list",
    "run.list",
    "run.get",
    "mcp.usage.get",
    "schedule.save.request",
    "schedule.delete.request",
    "trigger.save.request",
    "trigger.delete.request",
    "webhook.reconcile.request",
    "notification.rule.create.request",
    "notification.rule.delete.request",
  ]);

  const contract = await callTool(
    principal.accessToken,
    "execute-contract",
    "kody_execute_tool",
    { actionId: "mcp.contract.get", input: {} },
  );
  assert.equal(
    contract.body.result.structuredContent.contractVersion,
    "2026-09-04.1",
  );
  assert.equal(contract.body.result.structuredContent.workSystem, "todos");

  const features = await callTool(
    principal.accessToken,
    "execute-features",
    "kody_execute_tool",
    { actionId: "dashboard.features.list", input: {} },
  );
  assert.ok(features.body.result.structuredContent.families.includes("todos"));
  assert.ok(
    features.body.result.structuredContent.families.includes("automation"),
  );

  const notification = await mcpRequest(principal.accessToken, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  assert.equal(notification.response.status, 202);

  const stream = await fetch(`${baseUrl}/api/kody/mcp`, {
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      accept: "text/event-stream",
    },
  });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(await stream.text(), ": kody-mcp\n\n");

  const sessionDelete = await fetch(`${baseUrl}/api/kody/mcp`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${principal.accessToken}` },
  });
  assert.equal(sessionDelete.status, 400);

  const queryCredential = await fetch(
    `${baseUrl}/api/kody/mcp?token=${encodeURIComponent(principal.accessToken)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "query-token",
        method: "ping",
      }),
    },
  );
  assert.equal(queryCredential.status, 401);

  const unsupportedMedia = await fetch(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      "content-type": "text/plain",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "media", method: "ping" }),
  });
  assert.equal(unsupportedMedia.status, 415);
  assertSafeFailure(await unsupportedMedia.text(), principal.accessToken);

  const malformed = await jsonRequest(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      "content-type": "application/json",
    },
    body: "{not-json",
  });
  assert.equal(malformed.body.error.code, -32700);
  assertSafeFailure(JSON.stringify(malformed.body), principal.accessToken);

  const unknownMethod = await mcpRequest(principal.accessToken, {
    jsonrpc: "2.0",
    id: "unknown-method",
    method: "not/a/method",
  });
  assert.equal(unknownMethod.body.error.code, -32601);
  assertSafeFailure(JSON.stringify(unknownMethod.body), principal.accessToken);

  const unknownTool = await mcpRequest(principal.accessToken, {
    jsonrpc: "2.0",
    id: "unknown-tool",
    method: "tools/call",
    params: { name: "not_a_kody_tool", arguments: {} },
  });
  assert.equal(unknownTool.body.error.code, -32602);
  assertSafeFailure(JSON.stringify(unknownTool.body), principal.accessToken);

  const unknownAction = await callTool(
    principal.accessToken,
    "unknown-action",
    "kody_execute_tool",
    { actionId: "not.an.action", input: {} },
    true,
  );
  assert.equal(
    unknownAction.body.result.structuredContent.error.code,
    "action_not_found",
  );
  assertSafeFailure(JSON.stringify(unknownAction.body), principal.accessToken);

  const invalidInput = await callTool(
    principal.accessToken,
    "invalid-action-input",
    "kody_execute_tool",
    { actionId: "repository.scope.get", input: { unexpected: true } },
    true,
  );
  assert.equal(
    invalidInput.body.result.structuredContent.error.code,
    "invalid_input",
  );
  assertSafeFailure(JSON.stringify(invalidInput.body), principal.accessToken);

  const invalidOrigin = await fetch(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      "content-type": "application/json",
      origin: "https://invalid-origin.example",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "origin", method: "ping" }),
  });
  assert.equal(invalidOrigin.status, 403);

  const invalidProtocol = await jsonRequest(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2099-01-01",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "protocol", method: "ping" }),
  });
  assert.equal(invalidProtocol.response.status, 400);

  const oversized = await fetch(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${principal.accessToken}`,
      "content-type": "application/json",
    },
    body: "x".repeat(256 * 1024 + 1),
  });
  assert.equal(oversized.status, 413);

  assert.ok(convexUrl, "KODY_MCP_TEST_CONVEX_URL or CONVEX_URL is required");
  const backend = new ConvexHttpClient(convexUrl);
  const serviceKey = process.env.KODY_SERVICE_KEY;
  assert.ok(serviceKey, "KODY_SERVICE_KEY is required for Phase 2 live gates");
  const createdTokenIds = [];
  try {
    const expired = await createBackendToken(backend, serviceKey, principal, {
      scopes: ["mcp:read", "mcp:execute"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      name: "Expired MCP verification",
    });
    createdTokenIds.push(expired.tokenId);
    const expiredResult = await mcpRequest(expired.accessToken, {
      jsonrpc: "2.0",
      id: "expired",
      method: "ping",
    });
    assert.equal(expiredResult.response.status, 401);

    const readOnly = await createBackendToken(backend, serviceKey, principal, {
      scopes: ["mcp:read"],
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      name: "Read-only MCP verification",
    });
    createdTokenIds.push(readOnly.tokenId);
    const allowedRead = await callTool(
      readOnly.accessToken,
      "read-only-read",
      "kody_execute_tool",
      { actionId: "repository.scope.get", input: {} },
    );
    assert.equal(allowedRead.body.result.isError, false);
    const deniedExecution = await callTool(
      readOnly.accessToken,
      "read-only-write",
      "kody_execute_tool",
      {
        actionId: "work.create",
        idempotencyKey: "read-only-write",
        input: {
          recordId: "read-only-write",
          title: "Read-only permission test",
          objective: "This write must be rejected",
        },
      },
      true,
    );
    assert.equal(deniedExecution.body.result.isError, true);
    assert.equal(
      deniedExecution.body.result.structuredContent.error.code,
      "insufficient_scope",
    );

    const rateLimited = await createBackendToken(
      backend,
      serviceKey,
      principal,
      {
        scopes: ["mcp:read", "mcp:execute"],
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        name: "Rate-limit MCP verification",
      },
    );
    createdTokenIds.push(rateLimited.tokenId);
    const attempts = await mapWithConcurrency(
      Array.from({ length: 130 }, (_, index) => index),
      10,
      (index) =>
        retryServerFailure(() =>
          mcpRequest(rateLimited.accessToken, {
            jsonrpc: "2.0",
            id: `rate-${index}`,
            method: "ping",
          }),
        ),
    );
    const acceptedCount = attempts.filter(
      (attempt) => attempt.response.status === 200,
    ).length;
    const limitedCount = attempts.filter(
      (attempt) => attempt.response.status === 429,
    ).length;
    assert.ok(acceptedCount > 0 && acceptedCount <= 120);
    assert.equal(acceptedCount + limitedCount, attempts.length);

    const auditEvents = await backend.query(backendApi.mcpAuditEvents.list, {
      serviceKey,
      tenantId: repository,
      limit: 500,
    });
    assert.ok(
      auditEvents.some(
        (event) =>
          event.tokenId === principal.tokenId &&
          event.toolName === "kody_execute_tool" &&
          event.actionId === "repository.scope.get" &&
          event.outcome === "success",
      ),
      "successful MCP execution was absent from the audit log",
    );
  } finally {
    for (const createdTokenId of createdTokenIds) {
      const revoked = await backend.mutation(
        backendApi.mcpAccessTokens.revoke,
        {
          serviceKey,
          tenantId: repository,
          actorLogin: principal.actorLogin,
          tokenId: createdTokenId,
          revokedAt: new Date().toISOString(),
        },
      );
      assert.equal(revoked, true, "Phase 2 test token cleanup failed");
    }
  }

  return {
    tokenList: "passed",
    pagination: "passed",
    allCatalogActions: "passed",
    streamableHttp: "passed",
    safeErrors: "passed",
    contentType: "passed",
    expiration: "passed",
    permissionScope: "passed",
    rateLimit: "passed",
    invalidOrigin: "passed",
    invalidProtocol: "passed",
    requestLimit: "passed",
    audit: "passed",
  };
}

async function verifyPhaseThreeGates(principal) {
  assert.ok(convexUrl, "KODY_MCP_TEST_CONVEX_URL or CONVEX_URL is required");
  const serviceKey = process.env.KODY_SERVICE_KEY;
  assert.ok(serviceKey, "KODY_SERVICE_KEY is required for Phase 3 live gates");
  const backend = new ConvexHttpClient(convexUrl);
  const recordId = `mcp-live-${randomUUID()}`;
  const createdTokenIds = [];
  let memoryId;
  try {
    const codex = await createBackendToken(backend, serviceKey, principal, {
      scopes: ["mcp:read", "mcp:execute"],
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      name: "Codex Phase 3 verification",
    });
    const openCode = await createBackendToken(backend, serviceKey, principal, {
      scopes: ["mcp:read", "mcp:execute"],
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      name: "OpenCode Phase 3 verification",
    });
    createdTokenIds.push(codex.tokenId, openCode.tokenId);

    const createArgs = {
      actionId: "work.create",
      idempotencyKey: `create-${recordId}`,
      input: {
        recordId,
        title: "Live cross-agent handoff",
        objective: "Let OpenCode continue Codex work",
        goal: "Prove Phase 3",
        tasks: ["Persist work", "Continue from another agent"],
      },
    };
    const created = await callTool(
      codex.accessToken,
      "phase3-create",
      "kody_execute_tool",
      createArgs,
    );
    assert.equal(created.body.result.structuredContent.revision, 1);
    assert.equal(
      created.body.result.structuredContent.updatedBy.name,
      "Codex Phase 3 verification",
    );
    assert.ok(
      await backend.query(backendApi.repoDocs.get, {
        serviceKey,
        tenantId: repository,
        kind: `todo:${recordId}`,
      }),
      "the MCP endpoint and Phase 3 test were connected to different Convex deployments",
    );
    const retried = await callTool(
      codex.accessToken,
      "phase3-retry",
      "kody_execute_tool",
      createArgs,
    );
    assert.equal(retried.body.result.structuredContent.revision, 1);
    const conflictingRetry = await callTool(
      codex.accessToken,
      "phase3-conflicting-retry",
      "kody_execute_tool",
      {
        ...createArgs,
        input: { ...createArgs.input, objective: "Different input" },
      },
      true,
    );
    assert.equal(conflictingRetry.body.result.isError, true);

    const seenByOpenCode = await callTool(
      openCode.accessToken,
      "phase3-read",
      "kody_execute_tool",
      { actionId: "work.get", input: { recordId } },
    );
    assert.equal(
      seenByOpenCode.body.result.structuredContent.record.objective,
      createArgs.input.objective,
    );

    const writes = [
      ["work.checkpoint.add", { summary: "Codex persisted the shared record" }],
      [
        "work.decision.add",
        {
          summary: "Reuse Kody task state",
          rationale: "It already owns repository-scoped work",
        },
      ],
      [
        "work.evidence.add",
        {
          kind: "test",
          reference: "live:mcp",
          summary: "The second agent read the first agent's work",
        },
      ],
      [
        "work.artifact.add",
        {
          kind: "report",
          reference: `/todos/${recordId}`,
          summary: "Dashboard work detail",
        },
      ],
    ];
    let revision = 1;
    for (const [actionId, input] of writes) {
      const result = await callTool(
        codex.accessToken,
        `phase3-${actionId}`,
        "kody_execute_tool",
        {
          actionId,
          idempotencyKey: `${actionId}-${recordId}`,
          input: { recordId, expectedRevision: revision, ...input },
        },
      );
      revision = result.body.result.structuredContent.revision;
    }
    let hermesWork;
    if (testHermesClient) {
      hermesWork = await verifyHermesClient({
        recordId,
        expectedRevision: revision,
      });
      revision += 1;
      const afterHermes = await callTool(
        codex.accessToken,
        "phase3-after-hermes",
        "kody_execute_tool",
        { actionId: "work.get", input: { recordId } },
      );
      assert.equal(
        afterHermes.body.result.structuredContent.record.updatedBy.name,
        "Hermes MCP verification",
      );
      assert.equal(
        afterHermes.body.result.structuredContent.record.handoff.toAgent,
        "OpenCode",
      );
    }
    const stale = await callTool(
      openCode.accessToken,
      "phase3-stale",
      "kody_execute_tool",
      {
        actionId: "work.update",
        idempotencyKey: `stale-${recordId}`,
        input: {
          recordId,
          expectedRevision: 1,
          summary: "Overwrite newer work",
        },
      },
      true,
    );
    assert.equal(stale.body.result.isError, true);

    const handedOff = await callTool(
      openCode.accessToken,
      "phase3-handoff",
      "kody_execute_tool",
      {
        actionId: "work.handoff.create",
        idempotencyKey: `handoff-${recordId}`,
        input: {
          recordId,
          expectedRevision: revision,
          toAgent: "Hermes",
          summary: "Continue deployed UI verification",
          nextSteps: ["Open shared work", "Add final proof"],
        },
      },
    );
    assert.equal(
      handedOff.body.result.structuredContent.updatedBy.name,
      "OpenCode Phase 3 verification",
    );
    assert.equal(
      handedOff.body.result.structuredContent.handoff.toAgent,
      "Hermes",
    );

    const listed = await callTool(
      codex.accessToken,
      "phase3-list",
      "kody_execute_tool",
      { actionId: "work.list", input: { limit: 100 } },
    );
    assert.ok(
      listed.body.result.structuredContent.some(
        (record) => record.recordId === recordId,
      ),
    );

    const keyword = `ctx${randomBytes(5).toString("hex")}`;
    memoryId = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    await backend.mutation(backendApi.memories.create, {
      serviceKey,
      actor: { kind: "user", id: `github:${principal.actorGithubId}` },
      tenantId: repository,
      memory: {
        id: memoryId,
        scope: { kind: "repository", tenantId: repository },
        kind: "reference",
        content: {
          title: keyword,
          summary: "Phase 3 provenance",
          body: "Temporary live context proof",
        },
        currentRevisionId: revisionId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      },
      revision: {
        id: revisionId,
        memoryId,
        previousRevisionId: null,
        kind: "reference",
        content: {
          title: keyword,
          summary: "Phase 3 provenance",
          body: "Temporary live context proof",
        },
        evidence: [{ source: "user-input", id: `live-${recordId}` }],
        reason: "Phase 3 live verification",
        actor: { kind: "user", id: `github:${principal.actorGithubId}` },
        createdAt: now,
      },
    });
    let context;
    let directMemories = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      directMemories = await backend.query(backendApi.memories.search, {
        serviceKey,
        actor: { kind: "user", id: `github:${principal.actorGithubId}` },
        tenantId: repository,
        scope: { kind: "repository", tenantId: repository },
        searchText: keyword,
        limit: 5,
      });
      context = await callTool(
        openCode.accessToken,
        `phase3-context-${attempt}`,
        "kody_execute_tool",
        { actionId: "context.search", input: { query: keyword, limit: 5 } },
      );
      if (
        directMemories.some((memory) => memory.id === memoryId) &&
        context.body.result.structuredContent.items.some(
          (item) => item.memoryId === memoryId,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(
      directMemories.some((memory) => memory.id === memoryId),
      "temporary repository memory was absent from the Convex search index",
    );
    const found = context.body.result.structuredContent.items.find(
      (item) => item.memoryId === memoryId,
    );
    assert.ok(
      found,
      "temporary repository memory was absent from context.search",
    );
    assert.equal(found.provenance.repository, repository);
    assert.equal(found.provenance.revisionId, revisionId);

    return {
      create: "passed",
      idempotency: "passed",
      conflictProtection: "passed",
      attributedCrossAgentRead: "passed",
      checkpoint: "passed",
      evidence: "passed",
      decision: "passed",
      artifact: "passed",
      handoff: "passed",
      ...(hermesWork ? { hermesAgentHandoff: hermesWork } : {}),
      repositoryList: "passed",
      contextProvenance: "passed",
      recordId,
    };
  } finally {
    if (memoryId)
      await backend.mutation(backendApi.memories.remove, {
        serviceKey,
        actor: { kind: "user", id: `github:${principal.actorGithubId}` },
        tenantId: repository,
        memoryId,
      });
    await backend.mutation(backendApi.repoDocs.remove, {
      serviceKey,
      tenantId: repository,
      kind: `todo:${recordId}`,
    });
    for (const tokenId of createdTokenIds)
      await backend.mutation(backendApi.mcpAccessTokens.revoke, {
        serviceKey,
        tenantId: repository,
        actorLogin: principal.actorLogin,
        tokenId,
        revokedAt: new Date().toISOString(),
      });
  }
}

async function verifyPhaseFourGates(principal) {
  assert.ok(convexUrl, "KODY_MCP_TEST_CONVEX_URL or CONVEX_URL is required");
  const serviceKey = process.env.KODY_SERVICE_KEY;
  assert.ok(serviceKey, "KODY_SERVICE_KEY is required for Phase 4 live gates");
  const backend = new ConvexHttpClient(convexUrl);
  const recordId = `mcp-approval-live-${randomUUID()}`;
  let requestId;
  try {
    const created = await callTool(
      principal.accessToken,
      "phase4-work-create",
      "kody_execute_tool",
      {
        actionId: "work.create",
        idempotencyKey: `phase4-work-${recordId}`,
        input: {
          recordId,
          title: "Live agent execution approval",
          objective: "Prove a coding agent can request Kody Engine work",
          goal: "Validate Phase 4",
          tasks: [
            "Read Kody definitions",
            "Request capability",
            "Approve dispatch",
          ],
        },
      },
    );
    assert.equal(created.body.result.structuredContent.recordId, recordId);

    const readAction = async (actionId, input = {}) => {
      const result = await callTool(
        principal.accessToken,
        `phase4-${actionId}`,
        "kody_execute_tool",
        { actionId, input },
      );
      assert.equal(
        result.body.result.isError,
        false,
        JSON.stringify(result.body),
      );
      return result.body.result.structuredContent;
    };
    const policies = await readAction("policy.list");
    if (policies.length > 0)
      await readAction("policy.get", { id: policies[0].id });
    await readAction("instruction.get");
    const capabilities = await readAction("capability.list");
    const capability = ["health-check", "ci-health-check", "release-gate-probe"]
      .map((id) => capabilities.find((item) => (item.slug ?? item.id) === id))
      .find(Boolean);
    assert.ok(
      capability,
      "No safe live-test capability was available (health-check, ci-health-check, release-gate-probe)",
    );
    const capabilityId = capability.slug ?? capability.id;
    await readAction("capability.get", { id: capabilityId });
    const workflows = await readAction("workflow.list");
    if (workflows.length > 0)
      await readAction("workflow.get", { id: workflows[0].id });
    await readAction("quality.gates.get");
    await readAction("approval.list", { workRecordId: recordId });

    const beforeRuns = await githubWorkflowRuns();
    const requested = await callTool(
      principal.accessToken,
      "phase4-capability-request",
      "kody_execute_tool",
      {
        actionId: "capability.run.request",
        idempotencyKey: `phase4-capability-${recordId}`,
        input: { capabilityId, workRecordId: recordId, input: {} },
      },
    );
    const approval = requested.body.result.structuredContent;
    requestId = approval.requestId;
    assert.equal(approval.status, "pending");
    assert.equal(approval.targetKind, "capability");
    assert.doesNotMatch(JSON.stringify(approval), /approvalToken|tokenHash/);

    const pending = await readAction("approval.get", { requestId });
    assert.equal(pending.status, "pending");
    assert.doesNotMatch(JSON.stringify(pending), /approvalToken|tokenHash/);
    const listed = await readAction("approval.list", {
      workRecordId: recordId,
    });
    assert.ok(listed.some((item) => item.requestId === requestId));

    const approved = await jsonRequest(
      `${baseUrl}/api/kody/mcp/approvals/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        headers: dashboardHeaders,
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    assert.equal(approved.response.status, 202, JSON.stringify(approved.body));
    assert.equal(approved.body.status, "dispatched");
    assert.equal(approved.body.execution, "kody-engine");

    const dispatched = await readAction("approval.get", { requestId });
    assert.equal(dispatched.status, "dispatched");
    assert.equal(dispatched.result.execution, "kody-engine");
    assert.doesNotMatch(JSON.stringify(dispatched), /approvalToken|tokenHash/);
    const createdWorkflowRun = await waitForNewWorkflowRun(beforeRuns);
    const workflowRun = await waitForWorkflowRunCompletion(
      createdWorkflowRun.id,
    );
    assert.equal(
      workflowRun.conclusion,
      "success",
      `Kody Engine run failed: ${workflowRun.html_url}`,
    );

    return {
      policies: "passed",
      instructions: "passed",
      capabilities: "passed",
      workflows: "passed",
      qualityGates: "passed",
      approvalVisibility: "passed",
      noAgentApprovalAction: "passed",
      engineDispatch: "passed",
      capabilityId,
      requestId,
      githubRunId: workflowRun.id,
      githubRunUrl: workflowRun.html_url,
      githubRunStatus: workflowRun.status,
      githubRunConclusion: workflowRun.conclusion,
    };
  } finally {
    if (requestId)
      await backend.mutation(backendApi.mcpApprovalRequests.remove, {
        serviceKey,
        tenantId: repository,
        requestId,
      });
    await backend.mutation(backendApi.repoDocs.remove, {
      serviceKey,
      tenantId: repository,
      kind: `todo:${recordId}`,
    });
  }
}

async function verifyPhaseFiveGates(principal) {
  assert.ok(convexUrl, "KODY_MCP_TEST_CONVEX_URL or CONVEX_URL is required");
  const serviceKey = process.env.KODY_SERVICE_KEY;
  assert.ok(serviceKey, "KODY_SERVICE_KEY is required for Phase 5 live gates");
  const backend = new ConvexHttpClient(convexUrl);
  const suffix = randomBytes(5).toString("hex");
  const recordId = `mcp-automation-live-${suffix}`;
  const scheduleId = `mcp-schedule-${suffix}`;
  const triggerId = `mcp-trigger-${suffix}`;
  const notificationId = `mcp-notification-${suffix}`;
  const notificationSecret = `https://example.com/private-${suffix}`;
  const approvalRequestIds = [];
  let scheduleCreated = false;
  let triggerCreated = false;
  let notificationCreated = false;
  const readAction = async (actionId, input = {}, allowError = false) => {
    const result = await callTool(
      principal.accessToken,
      `phase5-${actionId}-${randomUUID()}`,
      "kody_execute_tool",
      { actionId, input },
      allowError,
    );
    if (!allowError)
      assert.equal(
        result.body.result.isError,
        false,
        JSON.stringify(result.body),
      );
    return result.body.result.structuredContent;
  };
  const requestAndDecide = async (actionId, input, decision = "approved") => {
    const requested = await callTool(
      principal.accessToken,
      `phase5-${actionId}`,
      "kody_execute_tool",
      {
        actionId,
        idempotencyKey: `${actionId}-${recordId}`,
        input: { workRecordId: recordId, ...input },
      },
    );
    const approval = requested.body.result.structuredContent;
    approvalRequestIds.push(approval.requestId);
    assert.equal(approval.status, "pending");
    assert.doesNotMatch(JSON.stringify(approval), /approvalToken|tokenHash/);
    const decided = await jsonRequest(
      `${baseUrl}/api/kody/mcp/approvals/${encodeURIComponent(approval.requestId)}`,
      {
        method: "POST",
        headers: dashboardHeaders,
        body: JSON.stringify({ decision }),
      },
    );
    assert.equal(
      decided.response.status,
      decision === "approved" ? 202 : 200,
      JSON.stringify(decided.body),
    );
    assert.equal(
      decided.body.status,
      decision === "approved" ? "dispatched" : "rejected",
    );
    return decided.body;
  };
  try {
    await callTool(principal.accessToken, "phase5-work", "kody_execute_tool", {
      actionId: "work.create",
      idempotencyKey: `phase5-work-${recordId}`,
      input: {
        recordId,
        title: "Live online automation",
        objective:
          "Prove a local coding agent can manage Kody online automation",
        goal: "Validate Phase 5",
        tasks: [
          "Inspect monitoring",
          "Save schedules and triggers",
          "Repair webhook",
        ],
      },
    });

    await readAction("schedule.list");
    const triggersBefore = await readAction("trigger.list");
    if (triggersBefore.length > 0)
      await readAction("trigger.get", { id: triggersBefore[0].id });
    const webhookBefore = await readAction("webhook.status");
    assert.ok(["ok", "degraded", "down"].includes(webhookBefore.level));
    await readAction("notification.rule.list");
    const runs = await readAction("run.list", { limit: 20 });
    if (runs.length > 0) await readAction("run.get", { runId: runs[0].runId });
    const usage = await readAction("mcp.usage.get");
    assert.equal(usage.rateLimitPerMinute, 120);
    assert.equal(usage.minimumDeprecationDays, 90);

    const savedSchedule = await requestAndDecide("schedule.save.request", {
      schedule: {
        id: scheduleId,
        every: "24h",
        target: { kind: "capability", id: "ci-health-check" },
        input: {},
        enabled: false,
      },
    });
    assert.equal(savedSchedule.execution, "kody-online");
    scheduleCreated = true;
    const schedule = await readAction("schedule.get", { id: scheduleId });
    assert.equal(schedule.id, scheduleId);
    assert.equal(schedule.enabled, false);

    const savedTrigger = await requestAndDecide("trigger.save.request", {
      trigger: {
        id: triggerId,
        name: "MCP live disabled trigger",
        enabled: false,
        event: "session.started",
        conditions: [],
        action: { type: "save-user-state", namespace: "mcp-live", map: {} },
      },
    });
    assert.equal(savedTrigger.execution, "kody-online");
    triggerCreated = true;
    const trigger = await readAction("trigger.get", { id: triggerId });
    assert.equal(trigger.id, triggerId);
    assert.equal(trigger.enabled, false);

    const savedNotification = await requestAndDecide(
      "notification.rule.create.request",
      {
        rule: {
          name: notificationId,
          event: "release_failed",
          channel: {
            type: "generic-webhook",
            url: notificationSecret,
          },
        },
      },
    );
    assert.equal(savedNotification.execution, "kody-online");
    assert.doesNotMatch(JSON.stringify(savedNotification), /private-/);
    notificationCreated = true;
    const notificationRules = await readAction("notification.rule.list");
    const notification = notificationRules.find(
      (item) => item.id === notificationId,
    );
    assert.deepEqual(notification.channel, { type: "generic-webhook" });
    assert.doesNotMatch(JSON.stringify(notificationRules), /private-/);

    const publicApproval = await readAction("approval.get", {
      requestId: savedNotification.requestId,
    });
    assert.equal(publicApproval.input, undefined);
    assert.doesNotMatch(JSON.stringify(publicApproval), /private-/);

    const activity = await jsonRequest(
      `${baseUrl}/api/kody/activity/agents?limit=100`,
      { headers: dashboardHeaders },
    );
    assert.equal(activity.response.status, 200, JSON.stringify(activity.body));
    const automationApproval = activity.body.runs
      .flatMap((run) => run.approvals ?? [])
      .find((approval) => approval.requestId === savedNotification.requestId);
    assert.equal(automationApproval.execution.status, "done");

    const productionWebhook = new URL(baseUrl).protocol === "https:";
    const webhook = await requestAndDecide(
      "webhook.reconcile.request",
      {},
      productionWebhook ? "approved" : "rejected",
    );
    if (productionWebhook) assert.equal(webhook.execution, "kody-online");

    await requestAndDecide("trigger.delete.request", { id: triggerId });
    triggerCreated = false;
    await requestAndDecide("schedule.delete.request", { id: scheduleId });
    scheduleCreated = false;
    await requestAndDecide("notification.rule.delete.request", {
      id: notificationId,
    });
    notificationCreated = false;

    const schedulesAfter = await readAction("schedule.list");
    const triggersAfter = await readAction("trigger.list");
    assert.ok(!schedulesAfter.some((item) => item.id === scheduleId));
    assert.ok(!triggersAfter.some((item) => item.id === triggerId));

    return {
      scheduleReadWriteDelete: "passed",
      eventTriggerReadWriteDelete: "passed",
      webhookMonitoring: "passed",
      webhookReconciliation: productionWebhook
        ? "passed"
        : "rejected-locally-as-designed",
      notificationRulesReadWriteDelete: "passed",
      automationActivityCompletion: "passed",
      remoteRunMonitoring: "passed",
      usageAnalyticsAndQuota: "passed",
      compatibilityPolicy: "passed",
    };
  } finally {
    if (triggerCreated)
      await jsonRequest(`${baseUrl}/api/kody/triggers/${triggerId}`, {
        method: "DELETE",
        headers: dashboardHeaders,
      });
    if (scheduleCreated)
      await jsonRequest(`${baseUrl}/api/kody/loops/${scheduleId}`, {
        method: "DELETE",
        headers: dashboardHeaders,
      });
    if (notificationCreated)
      await jsonRequest(`${baseUrl}/api/kody/notifications/${notificationId}`, {
        method: "DELETE",
        headers: dashboardHeaders,
      });
    for (const requestId of approvalRequestIds)
      await backend.mutation(backendApi.mcpApprovalRequests.remove, {
        serviceKey,
        tenantId: repository,
        requestId,
      });
    await backend.mutation(backendApi.repoDocs.remove, {
      serviceKey,
      tenantId: repository,
      kind: `todo:${recordId}`,
    });
  }
}

async function githubWorkflowRuns() {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/kody.yml/runs?event=workflow_dispatch&per_page=20`,
    {
      headers: {
        authorization: `Bearer ${githubToken}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.workflow_runs;
}

async function waitForNewWorkflowRun(beforeRuns) {
  const beforeIds = new Set(beforeRuns.map((run) => run.id));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runs = await githubWorkflowRuns();
    const found = runs.find((run) => !beforeIds.has(run.id));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Kody Engine GitHub Actions run was not created");
}

async function waitForWorkflowRunCompletion(runId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`,
      {
        headers: {
          authorization: `Bearer ${githubToken}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    const run = await response.json();
    assert.equal(response.status, 200, JSON.stringify(run));
    if (run.status === "completed") return run;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Kody Engine GitHub Actions run ${runId} did not complete`);
}

function assertSafeFailure(value, accessToken) {
  assert.doesNotMatch(
    value,
    new RegExp(accessToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(value, /tokenHash|stack trace|node_modules/i);
}

async function createBackendToken(backend, serviceKey, principal, options) {
  const accessToken = `kody_mcp_${randomBytes(32).toString("base64url")}`;
  const tokenId = randomUUID();
  await backend.mutation(backendApi.mcpAccessTokens.create, {
    serviceKey,
    tokenId,
    tokenHash: createHash("sha256").update(accessToken, "utf8").digest("hex"),
    name: options.name,
    tenantId: repository,
    actorLogin: principal.actorLogin,
    actorGithubId: principal.actorGithubId,
    scopes: options.scopes,
    createdAt: new Date().toISOString(),
    expiresAt: options.expiresAt,
  });
  return { accessToken, tokenId };
}

function verifyInstalledClients(token, expectedRepository) {
  const endpoint = `${baseUrl}/api/kody/mcp`;
  let claudeAdded = false;
  try {
    const clientEnvironment = {
      ...process.env,
      KODY_MCP_LIVE_TOKEN: token,
    };
    const added = spawnSync(
      "claude",
      [
        "mcp",
        "add",
        "--transport",
        "http",
        "--scope",
        "local",
        "kody",
        endpoint,
        "--header",
        "Authorization: Bearer ${KODY_MCP_LIVE_TOKEN}",
      ],
      {
        encoding: "utf8",
        timeout: 30_000,
        env: clientEnvironment,
      },
    );
    assert.equal(
      added.status,
      0,
      `Claude MCP setup failed: ${safeProcessError(added)}`,
    );
    claudeAdded = true;

    const claude = spawnSync("claude", ["mcp", "get", "kody"], {
      encoding: "utf8",
      timeout: 30_000,
      env: clientEnvironment,
    });
    assert.equal(
      claude.status,
      0,
      `Claude MCP connection check failed: ${safeProcessError(claude)}`,
    );
    assert.match(
      `${claude.stdout}\n${claude.stderr}`,
      /kody[\s\S]*(connected|✓)/i,
      "Claude Code did not report Kody as connected.",
    );

    const prompt = testPhaseFiveGates
      ? [
          "Use only the Kody MCP server.",
          "Call kody_status once.",
          'Call kody_execute_tool with {"actionId":"schedule.list","input":{}}.',
          'Call kody_execute_tool with {"actionId":"mcp.usage.get","input":{}}.',
          `If all calls succeed and repository is ${expectedRepository}, reply exactly KODY_CODEX_PHASE5_OK.`,
          "Do not call shell tools and do not edit files.",
        ].join(" ")
      : [
          "Use the Kody MCP server.",
          "Call kody_status exactly once.",
          `If status is ready and repository is ${expectedRepository}, reply exactly KODY_CODEX_OK.`,
          "Do not call shell tools and do not edit files.",
        ].join(" ");
    const codex = spawnSync(
      "codex",
      [
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        `mcp_servers.kody.url=${JSON.stringify(endpoint)}`,
        "-c",
        'mcp_servers.kody.bearer_token_env_var="KODY_MCP_LIVE_TOKEN"',
        "--json",
        prompt,
      ],
      {
        encoding: "utf8",
        timeout: 180_000,
        env: clientEnvironment,
      },
    );
    assert.equal(
      codex.status,
      0,
      `Codex MCP tool test failed: ${safeProcessError(codex)}`,
    );
    assert.match(
      codex.stdout,
      testPhaseFiveGates ? /KODY_CODEX_PHASE5_OK/ : /KODY_CODEX_OK/,
      "Codex did not confirm Kody status.",
    );
    assert.match(
      codex.stdout,
      /kody_status/,
      "Codex did not call kody_status.",
    );
    if (testPhaseFiveGates) {
      assert.match(
        codex.stdout,
        /schedule\.list/,
        "Codex did not list schedules.",
      );
      assert.match(
        codex.stdout,
        /mcp\.usage\.get/,
        "Codex did not read MCP usage.",
      );
    }

    return {
      claudeCode: "connected_without_model",
      codex: testPhaseFiveGates
        ? "called_kody_status_schedule_and_usage"
        : "called_kody_status",
    };
  } finally {
    if (claudeAdded) {
      spawnSync("claude", ["mcp", "remove", "--scope", "local", "kody"], {
        encoding: "utf8",
        timeout: 30_000,
      });
    }
  }
}

async function verifyHermesClient(work) {
  assert.ok(convexUrl, "KODY_MCP_TEST_CONVEX_URL or CONVEX_URL is required");
  const serviceKey = process.env.KODY_SERVICE_KEY;
  assert.ok(
    serviceKey,
    "KODY_SERVICE_KEY is required for the Hermes audit check",
  );

  const issued = await jsonRequest(`${baseUrl}/api/kody/mcp/tokens`, {
    method: "POST",
    headers: dashboardHeaders,
    body: JSON.stringify({ name: "Hermes MCP verification", expiresInDays: 1 }),
  });
  assert.equal(issued.response.status, 201, JSON.stringify(issued.body));

  const token = issued.body.accessToken;
  const tokenId = issued.body.token.tokenId;
  const hermesRoot =
    process.env.HERMES_AGENT_ROOT ?? join(homedir(), ".hermes", "hermes-agent");
  const hermesPython = join(hermesRoot, "venv", "bin", "python");
  const hermesHome = mkdtempSync(join(tmpdir(), "kody-hermes-mcp-"));
  const hermesEnvironment = {
    ...process.env,
    HERMES_HOME: hermesHome,
    KODY_MCP_LIVE_ENDPOINT: `${baseUrl}/api/kody/mcp`,
    KODY_MCP_LIVE_TOKEN: token,
  };
  const hermesEntrypoint = "from hermes_cli.main import main; main()";

  try {
    assert.ok(
      existsSync(hermesPython),
      `Hermes Python was not found at ${hermesPython}`,
    );
    for (const file of ["config.yaml", ".env"]) {
      const source = join(homedir(), ".hermes", file);
      if (existsSync(source)) {
        const target = join(hermesHome, file);
        copyFileSync(source, target);
        chmodSync(target, 0o600);
      }
    }

    const configure = spawnSync(
      hermesPython,
      [
        "-c",
        [
          "import os, yaml",
          "from pathlib import Path",
          'path = Path(os.environ["HERMES_HOME"]) / "config.yaml"',
          "config = yaml.safe_load(path.read_text()) if path.exists() else {}",
          "config = config or {}",
          'servers = config.setdefault("mcp_servers", {})',
          'servers["kody_live_test"] = {',
          '  "url": os.environ["KODY_MCP_LIVE_ENDPOINT"],',
          '  "headers": {"Authorization": "Bearer ${KODY_MCP_LIVE_TOKEN}"},',
          '  "tools": {"include": ["kody_status", "kody_search_tools", "kody_get_tool_details", "kody_read_tool", "kody_execute_tool"], "resources": False, "prompts": False},',
          '  "trust": "full",',
          "}",
          'if os.environ.get("HERMES_MCP_TEST_BASE_URL"):',
          '  config["model"] = {',
          '    "default": os.environ["HERMES_MCP_TEST_MODEL"],',
          '    "provider": "custom",',
          '    "base_url": os.environ["HERMES_MCP_TEST_BASE_URL"],',
          '    "context_length": 64000,',
          "  }",
          "path.write_text(yaml.safe_dump(config, sort_keys=False))",
        ].join("\n"),
      ],
      { encoding: "utf8", timeout: 30_000, env: hermesEnvironment },
    );
    assert.equal(
      configure.status,
      0,
      `Hermes test config failed: ${safeProcessError(configure)}`,
    );

    const connection = spawnSync(
      hermesPython,
      ["-c", hermesEntrypoint, "mcp", "test", "kody_live_test"],
      { encoding: "utf8", timeout: 60_000, env: hermesEnvironment },
    );
    assert.equal(
      connection.status,
      0,
      `Hermes MCP connection test failed: ${safeProcessError(connection)}`,
    );
    assert.match(
      `${connection.stdout}\n${connection.stderr}`,
      /Connected[\s\S]*kody_status/i,
      "Hermes did not discover the Kody MCP tools.",
    );

    const prompts = work
      ? [
          {
            marker: "KODY_HERMES_READ_OK",
            text: [
              "Use only the kody_live_test MCP server.",
              `Call mcp__kody_live_test__kody_execute_tool exactly once with arguments {\"actionId\":\"work.get\",\"input\":{\"recordId\":\"${work.recordId}\"}}.`,
              "If it succeeds, reply exactly KODY_HERMES_READ_OK. Do not call any other tool.",
            ].join(" "),
          },
          {
            marker: "KODY_HERMES_HANDOFF_OK",
            text: [
              "Use only the kody_live_test MCP server.",
              `Call mcp__kody_live_test__kody_execute_tool exactly once with arguments {\"actionId\":\"work.handoff.create\",\"idempotencyKey\":\"hermes-${work.recordId}\",\"input\":{\"recordId\":\"${work.recordId}\",\"expectedRevision\":${work.expectedRevision},\"toAgent\":\"OpenCode\",\"summary\":\"Hermes continued the shared Kody work\",\"nextSteps\":[\"Complete deployed verification\"]}}.`,
              "If it succeeds, reply exactly KODY_HERMES_HANDOFF_OK. Do not call any other tool.",
            ].join(" "),
          },
        ]
      : [
          {
            marker: "KODY_HERMES_OK",
            text: [
              "Use the kody_live_test MCP server.",
              "Call mcp__kody_live_test__kody_status exactly once.",
              `If status is ready and repository is ${repository}, reply exactly KODY_HERMES_OK.`,
              "Do not call terminal or file tools and do not edit anything.",
            ].join(" "),
          },
        ];
    const hermesModelArgs = [];
    if (process.env.HERMES_MCP_TEST_PROVIDER) {
      hermesModelArgs.push("--provider", process.env.HERMES_MCP_TEST_PROVIDER);
    }
    if (process.env.HERMES_MCP_TEST_MODEL) {
      hermesModelArgs.push("--model", process.env.HERMES_MCP_TEST_MODEL);
    }
    for (const prompt of prompts) {
      const hermes = spawnSync(
        hermesPython,
        [
          "-c",
          hermesEntrypoint,
          "--ignore-rules",
          "--reasoning",
          "none",
          "--toolsets",
          "kody_live_test",
          ...hermesModelArgs,
          "-z",
          prompt.text,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 120_000,
          env: hermesEnvironment,
        },
      );
      assert.equal(
        hermes.status,
        0,
        `Hermes MCP tool test failed: ${safeProcessError(hermes)}`,
      );
      assert.match(
        hermes.stdout,
        new RegExp(prompt.marker),
        `Hermes did not return ${prompt.marker}.`,
      );
    }

    const backend = new ConvexHttpClient(convexUrl);
    const auditEvents = await backend.query(backendApi.mcpAuditEvents.list, {
      serviceKey,
      tenantId: repository,
      limit: 500,
    });
    const hasAudit = (actionId) =>
      auditEvents.some(
        (event) =>
          event.tokenId === tokenId &&
          event.toolName === (work ? "kody_execute_tool" : "kody_status") &&
          (!actionId || event.actionId === actionId) &&
          event.outcome === "success",
      );
    assert.ok(
      hasAudit(work ? "work.handoff.create" : undefined) &&
        (!work || hasAudit("work.get")),
      work
        ? "Hermes work handoff was absent from the audit log"
        : "Hermes kody_status call was absent from the audit log",
    );

    return work ? "read_and_created_handoff" : "called_kody_status";
  } finally {
    rmSync(hermesHome, { recursive: true, force: true });
    const revoked = await jsonRequestWithNetworkRetry(
      `${baseUrl}/api/kody/mcp/tokens`,
      {
        method: "DELETE",
        headers: dashboardHeaders,
        body: JSON.stringify({ tokenId }),
      },
    );
    assert.equal(
      revoked.response.status,
      200,
      "Hermes test token revocation failed",
    );
  }
}

function safeProcessError(result) {
  const message = [result.error?.message, result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n");
  return message
    .replace(/kody_mcp_[A-Za-z0-9_-]+/g, "[redacted]")
    .slice(0, 2_000);
}

async function callTool(token, id, name, args, allowToolError = false) {
  const result = await mcpRequest(token, {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  if (!allowToolError)
    assert.equal(
      result.body.result.isError,
      false,
      JSON.stringify(result.body),
    );
  return result;
}

async function mcpRequest(token, body) {
  return await jsonRequest(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify(body),
  });
}

async function currentMcpRequest(token, body) {
  const name = body.method === "tools/call" ? body.params?.name : undefined;
  return await jsonRequest(`${baseUrl}/api/kody/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": body.method,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null,
  };
}

async function jsonRequestWithNetworkRetry(url, init) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await jsonRequest(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1)),
        );
    }
  }
  throw lastError;
}

function normalizeRepository(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.git$/, "");
  const match = trimmed.match(/(?:github\.com[/:])?([^/\s]+)\/([^/\s]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}
