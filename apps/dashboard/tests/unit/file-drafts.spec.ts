import { describe, expect, it } from "vitest";
import {
  fileDraftStorageKey,
  parseFileDraft,
  serializeFileDraft,
} from "@dashboard/features/file-manager/lib/file-drafts";

describe("file drafts", () => {
  it("scopes drafts by repository and path", () => {
    expect(fileDraftStorageKey("github:acme/repo", "docs/a.md")).toBe(
      "kody:file-draft:acme/repo/docs/a.md",
    );
  });

  it("round-trips versioned content and its base revision", () => {
    const serialized = serializeFileDraft({
      content: "local edit",
      baseSha: "sha-base",
      updatedAt: 123,
    });

    expect(parseFileDraft(serialized)).toEqual({
      version: 1,
      content: "local edit",
      baseSha: "sha-base",
      updatedAt: 123,
    });
  });

  it("rejects malformed or unsupported drafts", () => {
    expect(parseFileDraft("{bad")).toBeNull();
    expect(
      parseFileDraft(
        JSON.stringify({
          version: 2,
          content: "future",
          baseSha: "sha",
          updatedAt: 1,
        }),
      ),
    ).toBeNull();
  });
});
