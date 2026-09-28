import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const THEMED_FILE_SURFACES = [
  "FileContextMenu.tsx",
  "FileDiffViewer.tsx",
  "FileEditor.tsx",
  "FileSearch.tsx",
  "FileTree.tsx",
  "FileViewer.tsx",
  "UploadZone.tsx",
];

describe("file workspace themes", () => {
  it("uses shared theme colors instead of fixed dark surfaces", () => {
    for (const file of THEMED_FILE_SURFACES) {
      const source = readFileSync(
        resolve(
          process.cwd(),
          "src/dashboard/features/file-manager/components",
          file,
        ),
        "utf8",
      );

      expect(source, file).not.toMatch(/bg-\[#(?:090909|101010)\]/);
      expect(source, file).not.toContain("border-white/");
      expect(source, file).not.toContain("text-white/");
    }
  });

  it("fills the shared page content area without generic page padding", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FileWorkspaceShell.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      '<main className="min-h-0 flex-1 overflow-y-auto">',
    );
    expect(source).not.toContain("px-5 py-7");
  });

  it("keeps file mode controls in the header without split mode", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FileEditor.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('aria-label="Save changes"');
    expect(source).toContain('title="Discard unsaved changes"');
    expect(source).toContain('aria-label="Edit mode"');
    expect(source).toContain('aria-label="View mode"');
    expect(source).not.toContain('aria-label="Split mode"');
    expect(source).not.toMatch(/<Edit3[^>]*\/>\s*Edit/);
    expect(source).not.toMatch(/<Eye[^>]*\/>\s*View/);
    expect(source).toContain("{isDirty ? (");
    expect(source).not.toContain("Close");
  });

  it("uses one shared document typography for Markdown", () => {
    const editorSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FileEditor.tsx",
      ),
      "utf8",
    );
    const markdownEditorSource = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/base/src/markdown/MarkdownEditor.tsx",
      ),
      "utf8",
    );
    const markdownPreviewSource = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/base/src/markdown/MarkdownPreview.tsx",
      ),
      "utf8",
    );

    expect(markdownPreviewSource).toContain(
      '"prose prose-base max-w-none dark:prose-invert"',
    );
    expect(markdownPreviewSource).not.toContain("MarkdownPreviewVariant");
    expect(markdownPreviewSource).not.toContain('variant === "compact"');
    expect(markdownEditorSource).not.toContain("previewVariant");
    expect(editorSource).toContain("<MarkdownEditor");
  });

  it("recovers local drafts and always leaves a file-panel restore control", () => {
    const editorSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FileEditor.tsx",
      ),
      "utf8",
    );
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FilesPage.tsx",
      ),
      "utf8",
    );

    expect(editorSource).toContain("localStorage.getItem(draftStorageKey)");
    expect(editorSource).toMatch(/localStorage\.setItem\(\s*draftStorageKey/);
    expect(editorSource).toContain("localStorage.removeItem(draftStorageKey)");
    expect(pageSource).toContain('aria-label="Show file panel"');
    expect(editorSource).toContain("onShowFilePanel");
    expect(pageSource).not.toContain('panelState === "hidden" ? "w-12"');
  });

  it("does not expose unfinished file actions", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FilesPage.tsx",
      ),
      "utf8",
    );

    expect(pageSource).not.toContain("handleCreateSymlink");
    expect(pageSource).not.toContain("onCreateSymlink=");
  });

  it("keeps creation actions in the page menu and refresh before collapse", () => {
    const pageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FilesPage.tsx",
      ),
      "utf8",
    );
    const treeSource = readFileSync(
      resolve(
        process.cwd(),
        "src/dashboard/features/file-manager/components/FileTree.tsx",
      ),
      "utf8",
    );

    const actionsStart = pageSource.indexOf("const actions =");
    const actionsEnd = pageSource.indexOf("return (", actionsStart);
    const headerActions = pageSource.slice(actionsStart, actionsEnd);

    expect(headerActions).toContain('aria-label="More file actions"');
    expect(headerActions).toContain("handleNewFile(currentFolder)");
    expect(headerActions).toContain("handleNewFolder(currentFolder)");
    expect(headerActions.indexOf("<DropdownMenu>")).toBeLessThan(
      headerActions.indexOf("handleNewFile(currentFolder)"),
    );
    expect(treeSource.indexOf('aria-label="Refresh files"')).toBeLessThan(
      treeSource.indexOf('aria-label="Hide file panel"'),
    );
  });
});
