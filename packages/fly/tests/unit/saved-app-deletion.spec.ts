import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSavedAppVersion } from "../../builder/src/app-image-registry";
import { deleteSavedApp } from "../../src/hub/saved-apps";
import { listMachines } from "../../src/plugin/previews/machines-client";
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listMachines: vi.fn(),
}));
const id = "a".repeat(32),
  tag = `app-${id}`;
function mockRegistry(
  options: {
    tags?: string[];
    deleteStatus?: number;
    private?: boolean;
    badManifest?: boolean;
    secondPage?: boolean;
  } = {},
) {
  const fetch = vi.fn(async (url, init) => {
    if (init?.method === "DELETE")
      return new Response(null, { status: options.deleteStatus ?? 204 });
    if (String(url).includes("/versions?"))
      return Response.json(
        options.secondPage && !String(url).endsWith("page=2")
          ? Array.from({ length: 100 }, (_, i) => ({
              id: i + 1,
              metadata: { container: { tags: [`unrelated-${i}`] } },
            }))
          : [
              {
                id: 987,
                metadata: { container: { tags: options.tags ?? [tag] } },
              },
            ],
      );
    if (String(url).includes("/manifests/"))
      return Response.json({
        annotations: options.badManifest
          ? {}
          : {
              "app.flyhub.version": "1",
              "app.flyhub.source": "flyhub-app-test-123456789abc",
            },
      });
    if (String(url).startsWith("https://ghcr.io/token"))
      return Response.json({ token: "registry-bearer" });
    return Response.json({
      visibility: options.private === false ? "public" : "private",
      owner: { login: "owner" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe("delete a single private saved version", () => {
  it("matches the exact saved tag, including pagination, and deletes only that version", async () => {
    const fetch = mockRegistry({ secondPage: true });
    await deleteSavedAppVersion("owner", "github-secret", id);
    const deletes = fetch.mock.calls.filter(
      ([, init]) => init?.method === "DELETE",
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe(
      "https://api.github.com/user/packages/container/flyhub-saved-apps/versions/987",
    );
    expect(
      fetch.mock.calls.some(([url]) => String(url).endsWith("page=2")),
    ).toBe(true);
  });
  it.each([
    { private: false },
    { badManifest: true },
    { tags: [tag, "app-other-version"] },
  ])("refuses unsafe or shared versions: %j", async (options) => {
    const fetch = mockRegistry(options);
    await expect(
      deleteSavedAppVersion("owner", "github-secret", id),
    ).rejects.toThrow();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
      false,
    );
  });
  it("reports the exact permission needed without exposing credentials", async () => {
    mockRegistry({ deleteStatus: 403 });
    await expect(
      deleteSavedAppVersion("owner", "github-secret", id),
    ).rejects.toThrow("delete:packages");
    try {
      await deleteSavedAppVersion("owner", "github-secret", id);
    } catch (error) {
      expect(String(error)).not.toContain("github-secret");
    }
  });
  it("does not accept paths or external package identifiers", async () => {
    const fetch = mockRegistry();
    await expect(
      deleteSavedAppVersion("owner", "github-secret", "../../another-package"),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks deletion while an older active restore uses the version, even beyond the history limit", async () => {
    const metadata = {
      flyhub_image_org: "personal",
      flyhub_image_user: "owner",
      flyhub_image_status: "working",
      flyhub_image_action: "create",
      flyhub_image_ref: `ghcr.io/owner/flyhub-saved-apps:${tag}`,
    };
    vi.mocked(listMachines).mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: `worker-${i}`,
        state: "started",
        region: "lhr",
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        config: { metadata },
      })),
    );
    const fetch = vi.fn(async (url) =>
      Response.json({
        ...metadata,
        flyhub_image_status: String(url).includes("worker-20/")
          ? "working"
          : "completed",
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      deleteSavedApp(
        { token: "fly-secret", orgSlug: "personal", defaultRegion: "lhr" },
        { user: "owner", token: "github-secret" },
        id,
      ),
    ).rejects.toThrow("worker-20");
    expect(
      fetch.mock.calls.every(([url]) => String(url).includes("/metadata")),
    ).toBe(true);
  });
});
