import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"
const NOW = "2026-07-15T00:00:00.000Z"

describe("taskState", () => {
  it("saves and upserts docs per task and kind", async () => {
    const t = setup()
    await t.mutation(api.taskState.save, {
      tenantId: TENANT,
      taskKey: "issues/2",
      kind: "state",
      doc: { column: "todo" },
      updatedAt: NOW,
    })
    await t.mutation(api.taskState.save, {
      tenantId: TENANT,
      taskKey: "issues/2",
      kind: "state",
      doc: { column: "done" },
      updatedAt: NOW,
    })
    await t.mutation(api.taskState.save, {
      tenantId: TENANT,
      taskKey: "issues/2",
      kind: "context",
      doc: {},
      updatedAt: NOW,
    })

    const state = await t.query(api.taskState.get, {
      tenantId: TENANT,
      taskKey: "issues/2",
      kind: "state",
    })
    expect(state?.doc.column).toBe("done")
    expect(await t.query(api.taskState.list, { tenantId: TENANT, taskKey: "issues/2" })).toHaveLength(2)
  })

  it("rejects a stale conditional write", async () => {
    const t = setup()
    await t.mutation(api.taskState.save, {
      tenantId: TENANT,
      taskKey: "issues/3",
      kind: "state",
      doc: { column: "todo" },
      updatedAt: NOW,
    })

    await expect(
      t.mutation(api.taskState.save, {
        tenantId: TENANT,
        taskKey: "issues/3",
        kind: "state",
        doc: { column: "done" },
        updatedAt: "2026-07-15T00:01:00.000Z",
        expectedUpdatedAt: "stale",
      }),
    ).rejects.toThrow("Task state changed since it was read")
  })
})
