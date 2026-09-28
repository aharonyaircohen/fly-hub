import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mapWithConcurrency } from "./verify-public-mcp-helpers.mjs";

// Deliberately opt-in: this creates and deletes only this run's fixtures.
const endpoint = process.env.KODY_MCP_TEST_ENDPOINT;
const token = process.env.KODY_MCP_TEST_ACCESS_TOKEN;
const repository = process.env.KODY_MCP_TEST_REPOSITORY;
assert(
  endpoint &&
    token &&
    repository &&
    process.env.KODY_MCP_ALLOW_FIXTURES === "1",
  "Set endpoint, disposable repository, access token and KODY_MCP_ALLOW_FIXTURES=1",
);
assert(
  new URL(endpoint).protocol === "https:" ||
    new URL(endpoint).hostname === "127.0.0.1",
);
const prefix = `continuity-${randomUUID()}`;
const created = new Set();
const checks = [];
let attemptedCreate = false;

async function tool(name, args) {
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (response.status !== 429 || attempt === 3) break;
    const seconds = Math.min(
      60,
      Math.max(1, Number(response.headers.get("retry-after")) || 60),
    );
    console.log(JSON.stringify({ event: "rate_limit_wait", seconds }));
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
  assert.equal(response.status, 200, `MCP HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.error, "MCP protocol failure");
  return body.result;
}

async function action(id, input, write = false, key = randomUUID()) {
  const result = await tool(write ? "kody_execute_tool" : "kody_read_tool", {
    actionId: id,
    input,
    ...(write ? { idempotencyKey: key } : {}),
  });
  assert(
    !result.isError,
    `${id}: ${result.structuredContent?.error?.code ?? "failed"}`,
  );
  return result.structuredContent;
}

async function create(index, key = randomUUID()) {
  attemptedCreate = true;
  const result = await action(
    "memory.create",
    {
      scope: "repository",
      kind: "fact",
      title: `${prefix}-${index}`,
      summary: "Disposable continuity qualification fixture.",
      body: "Temporary fixture; not project knowledge.",
    },
    true,
    key,
  );
  created.add(result.memory.id);
  console.log(
    JSON.stringify({
      event: "fixture_created",
      memoryId: result.memory.id,
      prefix,
    }),
  );
  return result.memory;
}

let failure;
try {
  const status = (await tool("kody_status", {})).structuredContent;
  assert.equal(status.repository, repository);
  assert(
    status.grantedScopes.includes("memory:repository:delete"),
    "Fixture token needs cleanup permission",
  );
  for (const id of [
    "memory.create",
    "memory.get",
    "memory.revise",
    "memory.retire",
    "memory.history",
    "memory.list",
    "memory.delete",
  ]) {
    const details = await tool("kody_get_tool_details", { actionId: id });
    assert(!details.isError, `Missing action ${id}`);
    if (id === "memory.list")
      assert(
        details.structuredContent.inputSchema.properties.cursor,
        "Pagination is not deployed",
      );
  }
  const first = await create("lifecycle");
  const revised = (
    await action(
      "memory.revise",
      {
        memoryId: first.id,
        expectedRevisionId: first.currentRevisionId,
        kind: "fact",
        title: first.content.title,
        summary: "Corrected fixture.",
        body: "Corrected temporary fixture.",
      },
      true,
    )
  ).memory;
  const retireInput = {
    memoryId: revised.id,
    expectedRevisionId: revised.currentRevisionId,
    reason: "Fixture retirement",
  };
  const retireKey = randomUUID();
  const retired = (await action("memory.retire", retireInput, true, retireKey))
    .memory;
  assert.equal(retired.status, "superseded");
  const replay = (await action("memory.retire", retireInput, true, retireKey))
    .memory;
  assert.equal(replay.currentRevisionId, retired.currentRevisionId);
  assert.equal(
    (await action("memory.history", { memoryId: first.id })).revisions.length,
    3,
  );
  assert.equal(
    (await action("memory.get", { memoryId: first.id })).memory.status,
    "superseded",
  );
  checks.push("create/revise/retire/history/retry");

  const key = randomUUID();
  const duplicateResults = await Promise.allSettled([
    create("duplicate", key),
    create("duplicate", key),
  ]);
  const duplicates = duplicateResults.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  assert.equal(
    duplicates[0].id,
    duplicates[1].id,
    "Concurrent retry created duplicate memories",
  );
  checks.push("concurrent create deduplication");

  const fixtures = await mapWithConcurrency(
    Array.from({ length: 200 }, (_, i) => i),
    4,
    async (i) => {
      try {
        return { memory: await create(i) };
      } catch (error) {
        return { error };
      }
    },
  );
  for (const fixture of fixtures) if (fixture.error) throw fixture.error;
  const seen = new Set();
  let cursor;
  const cursors = new Set();
  do {
    const page = await action("memory.list", {
      scope: "repository",
      limit: 50,
      ...(cursor ? { cursor } : {}),
    });
    for (const memory of page.memories) {
      assert(!seen.has(memory.id), "Duplicate pagination row");
      seen.add(memory.id);
    }
    cursor = page.nextCursor;
    if (cursor) {
      assert(!cursors.has(cursor), "Cursor loop");
      cursors.add(cursor);
    }
  } while (cursor);
  assert(!seen.has(first.id), "Retired memory appeared in active recall");
  for (const memory of fixtures)
    assert(seen.has(memory.memory.id), "Pagination lost a fixture");
  checks.push("200-record pagination and retired exclusion");

  const deleteKey = randomUUID();
  await action("memory.delete", { memoryId: first.id }, true, deleteKey);
  await action("memory.delete", { memoryId: first.id }, true, deleteKey);
  created.delete(first.id);
  checks.push("deletion retry");
} catch (error) {
  failure = error;
} finally {
  let cleanupIncomplete = false;
  if (attemptedCreate) {
    try {
      let cursor;
      const visited = new Set();
      do {
        const page = await action("memory.list", {
          scope: "repository",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        for (const memory of page.memories)
          if (memory.content.title.startsWith(prefix)) created.add(memory.id);
        cursor = page.nextCursor;
        if (cursor) {
          assert(!visited.has(cursor), "Cleanup cursor loop");
          visited.add(cursor);
        }
      } while (cursor);
    } catch {
      cleanupIncomplete = true;
    }
  }
  const cleanup = await mapWithConcurrency([...created], 4, async (id) => {
    try {
      await action("memory.delete", { memoryId: id }, true);
      return true;
    } catch {
      return false;
    }
  });
  const failedCleanup = cleanup.filter((x) => !x).length;
  console.log(
    JSON.stringify({
      repository,
      prefix,
      checks,
      fixtureCount: created.size,
      failedCleanup,
      cleanupIncomplete,
      passed: !failure && !failedCleanup && !cleanupIncomplete,
    }),
  );
  if (failedCleanup || cleanupIncomplete) process.exitCode = 1;
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
