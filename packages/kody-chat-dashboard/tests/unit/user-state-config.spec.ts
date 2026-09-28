import { beforeEach, describe, expect, it, vi } from "vitest"

const backend = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock("@kody-ade/backend/api", () => ({ api: { repoDocs: { get: "repoDocs.get" } } }))
vi.mock("@kody-ade/backend/client", () => ({ createBackendClient: () => backend }))
vi.mock("@kody-ade/base/logger", () => ({ logger: { warn: vi.fn() } }))

import { _resetUserStateConfigCache, getUserStateNamespaces } from "../../src/dashboard/lib/user-state/config"

describe("Convex user-state configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetUserStateConfigCache()
    backend.query.mockResolvedValue(null)
  })

  it("keeps core namespaces when no Convex document exists", async () => {
    const namespaces = await getUserStateNamespaces({} as never, "acme", "shop")
    expect(namespaces.length).toBeGreaterThan(0)
    expect(namespaces.every((namespace) => namespace.origin === "core")).toBe(true)
  })

  it("loads valid brand namespaces from the repoDocs document", async () => {
    backend.query.mockResolvedValue({ doc: JSON.stringify({ version: 1, namespaces: [{ name: "quiz_results", version: 1, fields: [{ name: "score", type: "number" }] }] }) })
    const namespaces = await getUserStateNamespaces({} as never, "acme", "shop")
    expect(namespaces.some((namespace) => namespace.name === "quiz_results")).toBe(true)
  })

  it("caches by tenant", async () => {
    await getUserStateNamespaces({} as never, "acme", "shop")
    await getUserStateNamespaces({} as never, "acme", "shop")
    expect(backend.query).toHaveBeenCalledTimes(1)
  })
})
