import {
  advancedFilePreview,
  advancedFileSupportsTextEditing,
} from "./advanced-file-preview";

export type FilePreviewKind =
  "image" | "pdf" | "video" | "audio" | "unsupported";

export interface FilePreview {
  kind: FilePreviewKind;
  mediaType: string;
}

const FILE_PREVIEWS: Readonly<Record<string, FilePreview>> = {
  avif: { kind: "image", mediaType: "image/avif" },
  bmp: { kind: "image", mediaType: "image/bmp" },
  gif: { kind: "image", mediaType: "image/gif" },
  ico: { kind: "image", mediaType: "image/x-icon" },
  jpeg: { kind: "image", mediaType: "image/jpeg" },
  jpg: { kind: "image", mediaType: "image/jpeg" },
  png: { kind: "image", mediaType: "image/png" },
  svg: { kind: "image", mediaType: "image/svg+xml" },
  webp: { kind: "image", mediaType: "image/webp" },
  pdf: { kind: "pdf", mediaType: "application/pdf" },
  m4v: { kind: "video", mediaType: "video/x-m4v" },
  mov: { kind: "video", mediaType: "video/quicktime" },
  mp4: { kind: "video", mediaType: "video/mp4" },
  ogv: { kind: "video", mediaType: "video/ogg" },
  webm: { kind: "video", mediaType: "video/webm" },
  aac: { kind: "audio", mediaType: "audio/aac" },
  flac: { kind: "audio", mediaType: "audio/flac" },
  m4a: { kind: "audio", mediaType: "audio/mp4" },
  mp3: { kind: "audio", mediaType: "audio/mpeg" },
  oga: { kind: "audio", mediaType: "audio/ogg" },
  ogg: { kind: "audio", mediaType: "audio/ogg" },
  wav: { kind: "audio", mediaType: "audio/wav" },
};

const UNSUPPORTED_PREVIEW: FilePreview = {
  kind: "unsupported",
  mediaType: "application/octet-stream",
};

export function filePreview(path: string): FilePreview {
  const fileName = path.split("/").pop() ?? path;
  const separator = fileName.lastIndexOf(".");
  const extension =
    separator === -1 ? "" : fileName.slice(separator + 1).toLowerCase();

  return FILE_PREVIEWS[extension] ?? UNSUPPORTED_PREVIEW;
}

export function fileSupportsTextEditing(
  path: string,
  isBinary: boolean,
): boolean {
  return (
    !isBinary &&
    filePreview(path).kind === "unsupported" &&
    (advancedFilePreview(path) === null ||
      advancedFileSupportsTextEditing(path))
  );
}
