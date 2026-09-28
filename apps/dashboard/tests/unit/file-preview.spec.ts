import { describe, expect, it } from "vitest";
import {
  filePreview,
  fileSupportsTextEditing,
} from "@dashboard/features/file-manager/lib/file-preview";
import {
  advancedFilePreview,
  canPreviewAdvancedFile,
  MAX_ADVANCED_PREVIEW_SIZE_BYTES,
} from "@dashboard/features/file-manager/lib/advanced-file-preview";
import {
  createFilePreviewBlob,
  createFilePreviewFile,
} from "@dashboard/features/file-manager/lib/file-preview-source";

describe("filePreview", () => {
  it.each([
    ["photo.png", { kind: "image", mediaType: "image/png" }],
    ["document.pdf", { kind: "pdf", mediaType: "application/pdf" }],
    ["clip.mp4", { kind: "video", mediaType: "video/mp4" }],
    ["recording.mp3", { kind: "audio", mediaType: "audio/mpeg" }],
  ] as const)("maps %s to its native preview", (path, expected) => {
    expect(filePreview(path)).toEqual(expected);
  });

  it("uses a safe fallback for unknown binary extensions", () => {
    expect(filePreview("archive.custom")).toEqual({
      kind: "unsupported",
      mediaType: "application/octet-stream",
    });
  });

  it("matches extensions case-insensitively", () => {
    expect(filePreview("PHOTO.PNG")).toEqual({
      kind: "image",
      mediaType: "image/png",
    });
  });

  it("keeps media out of the text editor while allowing text and code", () => {
    expect(fileSupportsTextEditing("photo.png", false)).toBe(false);
    expect(fileSupportsTextEditing("report.docx", false)).toBe(false);
    expect(fileSupportsTextEditing("report.xlsx", false)).toBe(false);
    expect(fileSupportsTextEditing("archive.zip", false)).toBe(false);
    expect(fileSupportsTextEditing("README.md", false)).toBe(true);
    expect(fileSupportsTextEditing("src/index.ts", false)).toBe(true);
    expect(fileSupportsTextEditing("report.csv", false)).toBe(true);
    expect(fileSupportsTextEditing("report.tsv", false)).toBe(true);
    expect(fileSupportsTextEditing("report.fods", false)).toBe(true);
    expect(fileSupportsTextEditing("report.rtf", false)).toBe(true);
    expect(fileSupportsTextEditing("unknown.bin", true)).toBe(false);
  });

  it("creates a typed binary blob without embedding content in a data URL", () => {
    const blob = createFilePreviewBlob("aGVsbG8=", "image/png");

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5);
  });

  it("creates a named file for extension-based third-party renderers", () => {
    const file = createFilePreviewFile(
      "aGVsbG8=",
      "report.docx",
      "application/octet-stream",
    );

    expect(file.name).toBe("report.docx");
    expect(file.type).toBe("application/octet-stream");
    expect(file.size).toBe(5);
  });
});

describe("advancedFilePreview", () => {
  it("limits expensive browser parsing to bounded file sizes", () => {
    expect(canPreviewAdvancedFile(MAX_ADVANCED_PREVIEW_SIZE_BYTES)).toBe(true);
    expect(canPreviewAdvancedFile(MAX_ADVANCED_PREVIEW_SIZE_BYTES + 1)).toBe(
      false,
    );
    expect(canPreviewAdvancedFile(-1)).toBe(false);
  });

  it.each([
    "report.doc",
    "report.docx",
    "report.docm",
    "template.dot",
    "template.dotx",
    "template.dotm",
    "report.rtf",
    "report.odt",
  ])(
    "routes %s through the Word renderer",
    (path) => {
      expect(advancedFilePreview(path)).toEqual({ renderer: "word" });
    },
  );

  it("matches Word extensions case-insensitively", () => {
    expect(advancedFilePreview("REPORT.DOCX")).toEqual({ renderer: "word" });
  });

  it.each([
    "sheet.xls",
    "sheet.xlsx",
    "sheet.xlsm",
    "sheet.xlsb",
    "template.xlt",
    "template.xltx",
    "template.xltm",
    "sheet.ods",
    "sheet.fods",
    "sheet.numbers",
    "sheet.csv",
    "sheet.tsv",
  ])("routes %s through the spreadsheet renderer", (path) => {
    expect(advancedFilePreview(path)).toEqual({ renderer: "spreadsheet" });
  });

  it.each([
    "slides.pptx",
    "slides.pptm",
    "template.potx",
    "template.potm",
    "show.ppsx",
    "show.ppsm",
    "slides.odp",
  ])("routes %s through the presentation renderer", (path) => {
    expect(advancedFilePreview(path)).toEqual({ renderer: "presentation" });
  });

  it("matches presentation extensions case-insensitively", () => {
    expect(advancedFilePreview("SLIDES.PPTX")).toEqual({
      renderer: "presentation",
    });
  });

  it("routes only ZIP archives through the archive renderer", () => {
    expect(advancedFilePreview("bundle.zip")).toEqual({ renderer: "archive" });
    expect(advancedFilePreview("BUNDLE.ZIP")).toEqual({ renderer: "archive" });
    expect(advancedFilePreview("bundle.rar")).toBeNull();
    expect(advancedFilePreview("bundle.7z")).toBeNull();
    expect(advancedFilePreview("bundle.tar")).toBeNull();
  });

  it.each([
    "README.md",
    "preview.html",
    "photo.png",
    "document.pdf",
    "legacy.ppt",
    "archive.rar",
    "extensionless",
  ])("leaves %s with the existing preview path", (path) => {
    expect(advancedFilePreview(path)).toBeNull();
  });
});
