/**
 * Unit tests for repo-files helpers: base64 encoding/decoding (byte-safe UTF-8)
 * and search result line-index mapping.
 */
import { describe, it, expect, vi } from "vitest";
import {
  base64ToString,
  isBinaryBytes,
  listDir,
  readFile,
  stringToBase64,
  lineIndexFromFragment,
  repoPathExists,
} from "@dashboard/features/file-manager/lib/repo-files";

describe("listDir", () => {
  it("treats GitHub's empty-repository response as an empty root directory", async () => {
    const emptyRepositoryError = Object.assign(
      new Error(
        "This repository is empty. - https://docs.github.com/rest/repos/contents",
      ),
      {
        status: 404,
        response: {
          status: 404,
          data: {
            message: "This repository is empty.",
            documentation_url:
              "https://docs.github.com/rest/repos/contents#get-repository-content",
            status: "404",
          },
        },
      },
    );
    const getContent = vi.fn().mockRejectedValue(emptyRepositoryError);
    const octokit = { rest: { repos: { getContent } } };

    await expect(
      listDir(octokit as never, "acme", "empty-repo", ""),
    ).resolves.toEqual([]);
  });

  it("does not hide a missing repository", async () => {
    const notFoundError = Object.assign(new Error("Not Found"), {
      status: 404,
      response: {
        status: 404,
        data: { message: "Not Found", status: "404" },
      },
    });
    const getContent = vi.fn().mockRejectedValue(notFoundError);
    const octokit = { rest: { repos: { getContent } } };

    await expect(
      listDir(octokit as never, "acme", "missing-repo", ""),
    ).rejects.toBe(notFoundError);
  });

  it("does not treat an empty-repository error as an empty nested directory", async () => {
    const emptyRepositoryError = Object.assign(
      new Error(
        "This repository is empty. - https://docs.github.com/rest/repos/contents",
      ),
      {
        status: 404,
        response: {
          status: 404,
          data: { message: "This repository is empty.", status: "404" },
        },
      },
    );
    const getContent = vi.fn().mockRejectedValue(emptyRepositoryError);
    const octokit = { rest: { repos: { getContent } } };

    await expect(
      listDir(octokit as never, "acme", "empty-repo", "docs"),
    ).rejects.toBe(emptyRepositoryError);
  });
});

describe("readFile", () => {
  it("loads omitted GitHub content from the blob API before classifying an image", async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        path: "photo.png",
        sha: "image-sha",
        size: 1_154_974,
        encoding: "none",
        content: "",
      },
    });
    const getBlob = vi.fn().mockResolvedValue({
      data: {
        encoding: "base64",
        content: "iVBORw0KGgo=",
      },
    });
    const octokit = { rest: { repos: { getContent }, git: { getBlob } } };

    await expect(
      readFile(octokit as never, "acme", "repo", "photo.png"),
    ).resolves.toMatchObject({
      path: "photo.png",
      isBinary: true,
      content: "",
      base64Content: "iVBORw0KGgo=",
      encoding: "base64",
    });
    expect(getBlob).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      file_sha: "image-sha",
    });
  });

  it("keeps large UTF-8 files editable after loading their blob content", async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: {
        type: "file",
        path: "large.md",
        sha: "text-sha",
        size: 1_100_000,
        encoding: "none",
        content: "",
      },
    });
    const getBlob = vi.fn().mockResolvedValue({
      data: {
        encoding: "base64",
        content: stringToBase64("# Large document\n"),
      },
    });
    const octokit = { rest: { repos: { getContent }, git: { getBlob } } };

    await expect(
      readFile(octokit as never, "acme", "repo", "large.md"),
    ).resolves.toMatchObject({
      path: "large.md",
      isBinary: false,
      content: "# Large document\n",
      encoding: "base64",
    });
  });
});

describe("repoPathExists", () => {
  it("checks the parent listing without probing a missing target path", async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: [
        {
          name: "other.md",
          path: "notes/other.md",
          type: "file",
          size: 0,
          sha: "other",
        },
      ],
    });
    const octokit = { rest: { repos: { getContent } } };

    await expect(
      repoPathExists(octokit as never, "acme", "repo", "notes/test.md"),
    ).resolves.toBe(false);
    expect(getContent).toHaveBeenCalledWith({
      owner: "acme",
      repo: "repo",
      path: "notes",
    });
  });
});

// ─── base64 helpers ────────────────────────────────────────────────────────────

describe("base64ToString", () => {
  it("decodes a simple base64 string", () => {
    // "hello" in base64
    expect(base64ToString("aGVsbG8=")).toBe("hello");
  });

  it("decodes a multi-line base64 string", () => {
    // "hello\nworld" in base64
    expect(base64ToString("aGVsbG8Kd29ybGQ=")).toBe("hello\nworld");
  });

  it("handles UTF-8 content without corruption", () => {
    // "héllo wörld 😀" encoded as UTF-8 then base64
    const utf8Bytes = new TextEncoder().encode("héllo wörld 😀");
    let binary = "";
    for (const b of utf8Bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    expect(base64ToString(b64)).toBe("héllo wörld 😀");
  });

  it("handles hebrew characters", () => {
    const utf8Bytes = new TextEncoder().encode("שלום עולם");
    let binary = "";
    for (const b of utf8Bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    expect(base64ToString(b64)).toBe("שלום עולם");
  });

  it("handles CJK characters", () => {
    const utf8Bytes = new TextEncoder().encode("你好世界");
    let binary = "";
    for (const b of utf8Bytes) binary += String.fromCharCode(b);
    const b64 = btoa(binary);
    expect(base64ToString(b64)).toBe("你好世界");
  });

  it("round-trips ASCII text", () => {
    const original = "Hello, World! This is a test.";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });

  it("round-trips emoji without corruption", () => {
    const original = "File: 📄 — Status: ✅";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });

  it("round-trips mixed unicode (accents, CJK, emoji)", () => {
    const original = "café ☕ — 咖啡 — נעם";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });
});

describe("stringToBase64", () => {
  it("encodes a simple string", () => {
    expect(stringToBase64("hello")).toBe("aGVsbG8=");
  });

  it("round-trips a simple string", () => {
    const original = "plain text";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });

  it("round-trips a string with spaces and punctuation", () => {
    const original = "Hello, World! 123 @#$%";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });

  it("round-trips a string with newlines", () => {
    const original = "line1\nline2\nline3";
    expect(base64ToString(stringToBase64(original))).toBe(original);
  });
});

// ─── line mapping ──────────────────────────────────────────────────────────────

describe("lineIndexFromFragment", () => {
  it("returns 1 when match is at the start of a single-line fragment", () => {
    expect(lineIndexFromFragment("hello world", 0)).toBe(1);
  });

  it("returns 1 when match is in the first line", () => {
    expect(lineIndexFromFragment("hello world", 3)).toBe(1);
  });

  it("returns 2 when match is at the start of the second line", () => {
    const fragment = "line one\nline two";
    // index of 'l' in "line two"
    const idx = fragment.indexOf("line two");
    expect(lineIndexFromFragment(fragment, idx)).toBe(2);
  });

  it("returns 3 when match is in the third line", () => {
    const fragment = "line one\nline two\nline three";
    const idx = fragment.indexOf("line three");
    expect(lineIndexFromFragment(fragment, idx)).toBe(3);
  });

  it("handles empty fragment", () => {
    expect(lineIndexFromFragment("", 0)).toBe(1);
  });

  it("handles match at the very end of a multi-line fragment", () => {
    const fragment = "a\nb\nc";
    expect(lineIndexFromFragment(fragment, fragment.length - 1)).toBe(3);
  });

  it("correctly maps within a complex fragment", () => {
    const fragment =
      "const x = 1;\nconst y = 2;\nfunction test() {\n  return x + y;\n}";
    // Match is inside "return x + y" which is line 4
    const idx = fragment.indexOf("return");
    expect(lineIndexFromFragment(fragment, idx)).toBe(4);
  });
});

describe("isBinaryBytes", () => {
  it("keeps UTF-8 text editable", () => {
    expect(isBinaryBytes(new TextEncoder().encode("שלום world 😀"))).toBe(
      false,
    );
  });

  it("rejects content containing null bytes", () => {
    expect(isBinaryBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]))).toBe(
      true,
    );
  });

  it("rejects invalid UTF-8", () => {
    expect(isBinaryBytes(Uint8Array.from([0xff, 0xfe, 0xfd]))).toBe(true);
  });
});
