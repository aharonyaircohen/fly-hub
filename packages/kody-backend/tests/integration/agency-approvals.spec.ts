import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const base = {
  tenantId: "acme/docs",
  approvalId: "approval-1",
  scopeKind: "workflow" as const,
  scopeId: "documentation-agency",
  action: "run:input-hash",
  approvedBy: "github:42",
}

describe("agency approvals", () => {
  it("consumes an exact approval only once", async () => {
    const t = setup()
    await t.mutation(api.agencyModel.grantApproval, {
      ...base,
      approvedAt: "2026-07-30T10:00:00.000Z",
      expiresAt: "2026-07-30T10:15:00.000Z",
    })

    const first = await t.mutation(api.agencyModel.consumeApproval, {
      ...base,
      dispatchKey: "run-1",
      consumedAt: "2026-07-30T10:01:00.000Z",
    })
    const replay = await t.mutation(api.agencyModel.consumeApproval, {
      ...base,
      dispatchKey: "run-2",
      consumedAt: "2026-07-30T10:02:00.000Z",
    })

    expect(first).toBe(true)
    expect(replay).toBe(false)
    const approvals = await t.query(api.agencyModel.listApprovals, {
      tenantId: base.tenantId,
      scopeKind: "workflow",
      scopeId: base.scopeId,
      limit: 10,
    })
    expect(approvals[0]).toMatchObject({
      status: "consumed",
      dispatchKey: "run-1",
    })
  })

  it("rejects mismatched and expired approval claims", async () => {
    const t = setup()
    await t.mutation(api.agencyModel.grantApproval, {
      ...base,
      approvalId: "approval-expired",
      approvedAt: "2026-07-30T10:00:00.000Z",
      expiresAt: "2026-07-30T10:01:00.000Z",
    })

    await expect(
      t.mutation(api.agencyModel.consumeApproval, {
        ...base,
        approvalId: "approval-expired",
        approvedBy: "github:99",
        dispatchKey: "run-wrong-actor",
        consumedAt: "2026-07-30T10:00:30.000Z",
      }),
    ).resolves.toBe(false)
    await expect(
      t.mutation(api.agencyModel.consumeApproval, {
        ...base,
        approvalId: "approval-expired",
        dispatchKey: "run-expired",
        consumedAt: "2026-07-30T10:01:00.000Z",
      }),
    ).resolves.toBe(false)
  })
})
