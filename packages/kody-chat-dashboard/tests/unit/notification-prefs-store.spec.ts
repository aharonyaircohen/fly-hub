import { beforeEach, describe, expect, it, vi } from "vitest"

const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}))

vi.mock("@kody-ade/backend/api", () => ({ api: { notificationPrefs: { get: "get", save: "save" } } }))
vi.mock("@kody-ade/backend/client", () => ({ createBackendClient: () => backend }))
vi.mock("../github-client", () => ({ getOwner: () => "acme", getRepo: () => "app" }))

import {
  DEFAULT_NOTIFICATION_PREFS,
  _resetPrefsCache,
  readNotificationPrefs,
  writeNotificationPrefs,
} from "../../src/dashboard/lib/notifications/standalone-prefs-store"

describe("Convex notification preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetPrefsCache()
    backend.query.mockResolvedValue(null)
    backend.mutation.mockResolvedValue("pref-id")
  })

  it("returns defaults when no Convex document exists", async () => {
    await expect(readNotificationPrefs("Alice")).resolves.toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(backend.query).toHaveBeenCalledWith("get", { tenantId: expect.any(String), login: "alice" })
  })

  it("normalizes and caches Convex preferences", async () => {
    backend.query.mockResolvedValue({ prefs: { version: 1, mutedTypes: ["pr-ready"] } })
    await expect(readNotificationPrefs("Alice")).resolves.toEqual({ version: 1, mutedTypes: ["pr-ready"] })
    await readNotificationPrefs("alice")
    expect(backend.query).toHaveBeenCalled()
  })

  it("writes preferences to the tenant-scoped Convex document", async () => {
    const prefs = { version: 1 as const, mutedTypes: ["chat-response" as const] }
    await writeNotificationPrefs("Alice", prefs)
    expect(backend.mutation).toHaveBeenCalledWith("save", {
      tenantId: expect.any(String),
      login: "alice",
      prefs,
      updatedAt: expect.any(String),
    })
  })
})
