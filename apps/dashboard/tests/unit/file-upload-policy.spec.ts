import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_UPLOAD_POLICY,
  MARKDOWN_FILE_UPLOAD_POLICY,
  uploadInputAccept,
  validateUpload,
} from "@dashboard/features/file-manager/lib/file-upload-policy";
import { uploadRepositoryFiles } from "@dashboard/features/file-manager/lib/upload-repository-files";

function file(name: string, size = 10): File {
  return new File(["x".repeat(size)], name);
}

describe("file upload policy", () => {
  it("accepts ordinary repository files by default", () => {
    expect(validateUpload(file("asset.png"), DEFAULT_FILE_UPLOAD_POLICY)).toBe(
      null,
    );
  });

  it("keeps markdown workspaces limited to markdown files", () => {
    expect(validateUpload(file("guide.MD"), MARKDOWN_FILE_UPLOAD_POLICY)).toBe(
      null,
    );
    expect(validateUpload(file("asset.png"), MARKDOWN_FILE_UPLOAD_POLICY)).toBe(
      "Only Markdown files can be uploaded here.",
    );
  });

  it("rejects unsafe relative paths", () => {
    expect(
      validateUpload(
        file("../outside.md"),
        DEFAULT_FILE_UPLOAD_POLICY,
        "../outside.md",
      ),
    ).toBe("The upload path must stay inside this workspace.");
  });

  it("provides the native picker restriction for configured extensions", () => {
    expect(uploadInputAccept(MARKDOWN_FILE_UPLOAD_POLICY)).toBe(".md");
    expect(uploadInputAccept(DEFAULT_FILE_UPLOAD_POLICY)).toBeUndefined();
  });
});

describe("repository upload orchestration", () => {
  it("keeps validation separate from the repository adapter", async () => {
    const uploadedPaths: string[] = [];

    const result = await uploadRepositoryFiles({
      files: [file("guide.md"), file("asset.png")],
      destinationDir: "docs",
      policy: MARKDOWN_FILE_UPLOAD_POLICY,
      upload: async (path) => {
        uploadedPaths.push(path);
        return { sha: "uploaded-sha" };
      },
    });

    expect(uploadedPaths).toEqual(["docs/guide.md"]);
    expect(result.uploaded.map(({ path }) => path)).toEqual(["docs/guide.md"]);
    expect(result.rejected.map(({ path, error }) => ({ path, error }))).toEqual(
      [
        {
          path: "docs/asset.png",
          error: "Only Markdown files can be uploaded here.",
        },
      ],
    );
  });

  it("keeps scoped uploads inside the workspace root", async () => {
    const result = await uploadRepositoryFiles({
      files: [file("guide.md")],
      destinationDir: "outside",
      workspaceRoot: "docs",
      upload: async () => ({ sha: "must-not-run" }),
    });

    expect(result.uploaded).toEqual([]);
    expect(result.rejected[0]?.error).toBe(
      "The upload path must stay inside this workspace.",
    );
  });
});
