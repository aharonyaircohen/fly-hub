import { describe, it, expect } from "vitest";

import {
  addEnvironment,
  addBranchPreviewEnvironment,
  addPreviewFolder,
  addRepoViewEnvironment,
  addUploadedEnvironment,
  daysUntilExpiry,
  expiredUploads,
  isFlyBranchEnvironment,
  moveEnvironmentToFolder,
  normalizeEnvUrl,
  normalizeRepoViewPath,
  removePreviewFolder,
  repoViewIdFromPath,
  reorderEnvironment,
  resolveEnvironments,
  resolvePreviewFolders,
  setEnvExpiry,
  STATIC_PREVIEW_TTL_MS,
  type PreviewEnvironment,
  updatePreviewFolder,
} from "@kody-ade/fly/preview-environments";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("addEnvironment", () => {
  it("keeps saved-view labels unique", () => {
    const existing: PreviewEnvironment[] = [
      { id: "docs", label: "example.com docs", url: "https://other.test" },
      {
        id: "docs-2",
        label: "example.com docs 2",
        url: "https://another.test",
      },
    ];

    const next = addEnvironment(
      existing,
      "example.com docs",
      "https://example.com/docs",
    );

    expect(next.at(-1)?.label).toBe("example.com docs 3");
  });
});

function uploaded(id: string, expiresAt: number): PreviewEnvironment {
  return {
    id,
    label: id,
    url: `https://${id}.fly.dev`,
    staticId: id,
    expiresAt,
  };
}

describe("daysUntilExpiry", () => {
  it("ceils partial days and goes negative once past", () => {
    expect(daysUntilExpiry(NOW + 3 * DAY, NOW)).toBe(3);
    expect(daysUntilExpiry(NOW + 2.1 * DAY, NOW)).toBe(3); // ceil
    expect(daysUntilExpiry(NOW, NOW)).toBe(0);
    expect(daysUntilExpiry(NOW - DAY, NOW)).toBe(-1);
  });
});

describe("addUploadedEnvironment", () => {
  it("tags the new env with staticId + expiresAt", () => {
    const next = addUploadedEnvironment(
      [],
      "report.html",
      "https://kp-x.fly.dev",
      "abc123",
      NOW + STATIC_PREVIEW_TTL_MS,
    );
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      label: "report.html",
      url: "https://kp-x.fly.dev",
      staticId: "abc123",
      expiresAt: NOW + STATIC_PREVIEW_TTL_MS,
    });
  });

  it("keeps a readable upload context for chat", () => {
    const next = addUploadedEnvironment(
      [],
      "landing.html",
      "https://kp-x.fly.dev",
      "abc123",
      NOW + STATIC_PREVIEW_TTL_MS,
      {
        name: "landing.html",
        mimeType: "text/html",
        size: 2048,
        title: "Landing",
        outline: "h1: Welcome\nbutton: Start",
      },
    );
    expect(next[0].uploadContext).toMatchObject({
      name: "landing.html",
      title: "Landing",
      outline: "h1: Welcome\nbutton: Start",
    });
  });

  it("is a no-op on a missing staticId or bad url", () => {
    expect(addUploadedEnvironment([], "x", "not-a-url", "id", NOW)).toEqual([]);
    expect(addUploadedEnvironment([], "x", "https://ok.dev", "", NOW)).toEqual(
      [],
    );
  });
});

describe("repo view paths", () => {
  it("reads backend repo view paths and rejects removed legacy paths", () => {
    expect(repoViewIdFromPath("legacy/views/mobile-html-1234")).toBeNull();
    expect(repoViewIdFromPath("views/mobile-html-1234")).toBe(
      "mobile-html-1234",
    );
  });

  it("stores new repo view environments with backend paths", () => {
    expect(normalizeRepoViewPath("legacy/views/mobile-html-1234")).toBeNull();

    const next = addRepoViewEnvironment(
      [],
      "Mobile",
      "/api/kody/views/mobile-html-1234/index.html",
      "views/mobile-html-1234",
      undefined,
      {
        sourceUrl:
          "https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
        entryPath: "index.html",
      },
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.repoViewPath).toBe("views/mobile-html-1234");
    expect(next[0]?.repoViewSourceUrl).toBe(
      "https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
    );
    expect(next[0]?.repoViewEntryPath).toBe("index.html");
  });
});

describe("addBranchPreviewEnvironment", () => {
  it("stores branch preview identity without a URL", () => {
    const next = addBranchPreviewEnvironment([], "owner/repo", "dev");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      label: "dev",
      flyBranch: { repo: "owner/repo", branch: "dev" },
    });
    expect(next[0].url).toBeUndefined();
    expect(isFlyBranchEnvironment(next[0])).toBe(true);
  });

  it("rejects invalid repo or branch values", () => {
    expect(addBranchPreviewEnvironment([], "owner", "dev")).toEqual([]);
    expect(addBranchPreviewEnvironment([], "owner/repo", "bad branch")).toEqual(
      [],
    );
  });
});

describe("normalizeEnvUrl", () => {
  it("accepts dashboard-served view URLs", () => {
    expect(normalizeEnvUrl("/api/kody/views/mobile-html-1234/index.html")).toBe(
      "/api/kody/views/mobile-html-1234/index.html",
    );
  });
});

describe("expiredUploads", () => {
  it("returns only uploaded envs at/past expiry", () => {
    const list: PreviewEnvironment[] = [
      uploaded("dead", NOW - DAY),
      uploaded("exactly-now", NOW),
      uploaded("alive", NOW + DAY),
      { id: "plain", label: "Prod", url: "https://prod.dev" }, // no expiry
    ];
    const ids = expiredUploads(list, NOW).map((e) => e.id);
    expect(ids).toEqual(["dead", "exactly-now"]);
  });

  it("never reaps a plain URL environment", () => {
    const list: PreviewEnvironment[] = [
      { id: "plain", label: "Prod", url: "https://prod.dev" },
    ];
    expect(expiredUploads(list, NOW + 10 * DAY)).toEqual([]);
  });
});

describe("setEnvExpiry", () => {
  it("updates only the matching env, immutably", () => {
    const list = [uploaded("a", NOW), uploaded("b", NOW)];
    const next = setEnvExpiry(list, "a", NOW + 5 * DAY);
    expect(next[0].expiresAt).toBe(NOW + 5 * DAY);
    expect(next[1].expiresAt).toBe(NOW);
    expect(next).not.toBe(list);
  });
});

describe("resolveEnvironments", () => {
  it("treats an explicit empty list as empty instead of falling back", () => {
    expect(
      resolveEnvironments({
        namedPreviews: [],
        defaultPreviewUrl: "https://legacy.example.com",
      }),
    ).toEqual([]);
  });

  it("preserves staticId + expiresAt through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [uploaded("up", NOW + DAY)],
    });
    expect(out[0]).toMatchObject({ staticId: "up", expiresAt: NOW + DAY });
  });

  it("preserves uploadContext through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [
        {
          ...uploaded("up", NOW + DAY),
          uploadContext: {
            name: "up.html",
            mimeType: "text/html",
            size: 123,
            outline: "h1: Uploaded",
          },
        },
      ],
    });
    expect(out[0].uploadContext).toMatchObject({
      name: "up.html",
      outline: "h1: Uploaded",
    });
  });

  it("preserves branch preview identity through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [
        {
          id: "dev",
          label: "dev",
          flyBranch: { repo: "owner/repo", branch: "dev" },
        },
      ],
    });
    expect(out[0]).toMatchObject({
      flyBranch: { repo: "owner/repo", branch: "dev" },
    });
  });

  it("preserves repo-backed source pointers through the read mapping", () => {
    const out = resolveEnvironments({
      namedPreviews: [
        {
          id: "mobile",
          label: "Mobile",
          url: "/api/kody/views/mobile-html-1234/index.html",
          repoViewPath: "views/mobile-html-1234",
          repoViewSourceUrl:
            "https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
          repoViewEntryPath: "index.html",
        },
      ],
    });
    expect(out[0]).toMatchObject({
      repoViewPath: "views/mobile-html-1234",
      repoViewSourceUrl:
        "https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
      repoViewEntryPath: "index.html",
    });
  });
});

describe("preview folders", () => {
  it("adds and removes folders with stable labels", () => {
    const folders = addPreviewFolder([], " QA ");
    expect(folders).toHaveLength(1);
    expect(folders[0]?.label).toBe("QA");
    expect(folders[0]?.id.startsWith("qa-")).toBe(true);
    expect(removePreviewFolder(folders, folders[0]!.id)).toEqual([]);
  });

  it("ignores empty folder labels", () => {
    expect(addPreviewFolder([], "   ")).toEqual([]);
  });

  it("renames folders without changing their id", () => {
    const folders = [{ id: "qa", label: "QA" }];
    expect(updatePreviewFolder(folders, "qa", " Review ")).toEqual([
      { id: "qa", label: "Review" },
    ]);
    expect(updatePreviewFolder(folders, "qa", "   ")).toBe(folders);
  });

  it("resolves only well-shaped folders", () => {
    expect(
      resolvePreviewFolders([{ id: "qa", label: "QA" }, { id: "bad" }, null]),
    ).toEqual([{ id: "qa", label: "QA" }]);
  });

  it("moves an environment into and out of a folder", () => {
    const list: PreviewEnvironment[] = [
      { id: "prod", label: "Prod", url: "https://prod.dev" },
    ];
    const inFolder = moveEnvironmentToFolder(list, "prod", "qa");
    expect(inFolder[0]?.folderId).toBe("qa");
    const inRoot = moveEnvironmentToFolder(inFolder, "prod", null);
    expect(inRoot[0]?.folderId).toBeUndefined();
  });

  it("reorders an environment before another row and updates its folder", () => {
    const list: PreviewEnvironment[] = [
      { id: "a", label: "A", url: "https://a.dev" },
      { id: "b", label: "B", url: "https://b.dev", folderId: "qa" },
      { id: "c", label: "C", url: "https://c.dev", folderId: "qa" },
    ];
    const next = reorderEnvironment(list, "a", "c", "qa");
    expect(next.map((env) => env.id)).toEqual(["b", "a", "c"]);
    expect(next[1]?.folderId).toBe("qa");
  });
});
