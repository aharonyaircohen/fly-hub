"use client";

import { useEffect, useState } from "react";
import type { FilePreview } from "./file-preview";
import { createFilePreviewBlob } from "./file-preview-source";

export function useFilePreviewUrl(
  preview: FilePreview,
  base64Content: string,
): string | null {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setPreviewUrl(null);
    if (preview.kind === "unsupported" || !base64Content) return;

    const objectUrl = URL.createObjectURL(
      createFilePreviewBlob(base64Content, preview.mediaType),
    );
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [base64Content, preview.kind, preview.mediaType]);

  return previewUrl;
}
