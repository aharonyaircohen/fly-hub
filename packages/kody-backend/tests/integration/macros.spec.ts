import { describe, expect, it } from "vitest"
import { api } from "../../convex/_generated/api"
import { setup } from "./helpers"

const TENANT = "acme/app"

describe("macros", () => {
  it("saves and upserts macros", async () => {
    const t = setup()
    await t.mutation(api.macros.save, {
      tenantId: TENANT,
      macroId: "m1",
      macro: { id: "m1", name: "One" },
    })
    await t.mutation(api.macros.save, {
      tenantId: TENANT,
      macroId: "m1",
      macro: { id: "m1", name: "Renamed" },
    })
    const macros = await t.query(api.macros.list, { tenantId: TENANT })
    expect(macros).toHaveLength(1)
    expect(macros[0].macro.name).toBe("Renamed")
  })
})

describe("macros schema enforcement", () => {
  it("rejects a macro without a name", async () => {
    const t = setup()
    await expect(
      t.mutation(api.macros.save, {
        tenantId: TENANT,
        macroId: "bad",
        macro: { id: "bad" },
      }),
    ).rejects.toThrow()
  })
})
