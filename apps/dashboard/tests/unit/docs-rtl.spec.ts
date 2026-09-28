import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FILE_EDITOR_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/dashboard/features/file-manager/components/FileEditor.tsx",
  ),
  "utf8",
);
const MARKDOWN_VIEWER_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/kody-chat-dashboard/src/dashboard/lib/components/MarkdownViewer.tsx",
  ),
  "utf8",
);
const MARKDOWN_EDITOR_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "../../packages/base/src/markdown/MarkdownEditor.tsx",
  ),
  "utf8",
);

describe("docs RTL rendering", () => {
  it("renders selected docs with automatic markdown direction", () => {
    expect(FILE_EDITOR_SOURCE).toContain("<MarkdownEditor");
    expect(MARKDOWN_EDITOR_SOURCE).toContain("{...autoDirProps}");
    expect(MARKDOWN_EDITOR_SOURCE).toContain("text-start");
    expect(MARKDOWN_EDITOR_SOURCE).toContain("rtlAwareMarkdownClassName");
  });

  it("keeps standalone markdown docs RTL-aware too", () => {
    expect(MARKDOWN_VIEWER_SOURCE).toContain("{...autoDirProps}");
    expect(MARKDOWN_VIEWER_SOURCE).toContain("text-start");
    expect(MARKDOWN_VIEWER_SOURCE).toContain("rtlAwareMarkdownClassName");
  });
});
