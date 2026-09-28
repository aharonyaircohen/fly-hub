import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"

describe("dailyLogs", () => {
  it("appends entries with per-day sequences and reads them back", async () => {
    const t = setup()
    for (const n of [1, 2]) {
      await t.mutation(api.dailyLogs.append, {
        tenantId: TENANT,
        stream: "activity",
        date: "2026-07-12",
        entry: { n },
      })
    }
    await t.mutation(api.dailyLogs.append, {
      tenantId: TENANT,
      stream: "activity",
      date: "2026-07-13",
      entry: { n: 9 },
    })

    const day = await t.query(api.dailyLogs.forDate, {
      tenantId: TENANT,
      stream: "activity",
      date: "2026-07-12",
    })
    expect(day.map((e) => e.seq)).toEqual([0, 1])
  })

  it("keeps activity and events streams separate", async () => {
    const t = setup()
    await t.mutation(api.dailyLogs.append, {
      tenantId: TENANT,
      stream: "events",
      date: "2026-07-12",
      entry: {},
    })
    const activity = await t.query(api.dailyLogs.forDate, {
      tenantId: TENANT,
      stream: "activity",
      date: "2026-07-12",
    })
    expect(activity).toHaveLength(0)
  })
})
