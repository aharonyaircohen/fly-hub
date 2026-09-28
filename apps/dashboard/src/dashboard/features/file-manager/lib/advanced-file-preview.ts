export type AdvancedFileRenderer =
  "archive" | "presentation" | "spreadsheet" | "word";

export interface AdvancedFilePreview {
  renderer: AdvancedFileRenderer;
}

export const MAX_ADVANCED_PREVIEW_SIZE_BYTES = 25 * 1024 * 1024;

export function canPreviewAdvancedFile(size: number): boolean {
  return size >= 0 && size <= MAX_ADVANCED_PREVIEW_SIZE_BYTES;
}

const WORD_EXTENSIONS = new Set([
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "odt",
  "rtf",
]);
const ARCHIVE_EXTENSIONS = new Set(["zip"]);
const PRESENTATION_EXTENSIONS = new Set([
  "potm",
  "potx",
  "odp",
  "ppsm",
  "ppsx",
  "pptm",
  "pptx",
]);
const SPREADSHEET_EXTENSIONS = new Set([
  "csv",
  "fods",
  "numbers",
  "ods",
  "tsv",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlt",
  "xltm",
  "xltx",
]);

const EDITABLE_ADVANCED_EXTENSIONS = new Set(["csv", "fods", "rtf", "tsv"]);

function fileExtension(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  const separator = fileName.lastIndexOf(".");
  return separator === -1 ? "" : fileName.slice(separator + 1).toLowerCase();
}

export function advancedFileSupportsTextEditing(path: string): boolean {
  return EDITABLE_ADVANCED_EXTENSIONS.has(fileExtension(path));
}

export function advancedFilePreview(path: string): AdvancedFilePreview | null {
  const extension = fileExtension(path);

  if (WORD_EXTENSIONS.has(extension)) return { renderer: "word" };
  if (PRESENTATION_EXTENSIONS.has(extension)) {
    return { renderer: "presentation" };
  }
  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return { renderer: "spreadsheet" };
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) return { renderer: "archive" };
  return null;
}
