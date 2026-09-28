"use client";

import Image from "next/image";
import type { FilePreview } from "../lib/file-preview";

interface NativeFilePreviewProps {
  fileName: string;
  preview: FilePreview;
  sourceUrl: string;
}

export function NativeFilePreview({
  fileName,
  preview,
  sourceUrl,
}: NativeFilePreviewProps) {
  switch (preview.kind) {
    case "image":
      return (
        <div className="relative h-full overflow-hidden rounded-xl border border-border bg-card">
          <Image
            src={sourceUrl}
            alt={`Preview of ${fileName}`}
            fill
            unoptimized
            className="object-contain p-4"
          />
        </div>
      );
    case "pdf":
      return (
        <iframe
          src={sourceUrl}
          title={`Preview of ${fileName}`}
          className="h-full w-full rounded-xl border border-border bg-card"
        />
      );
    case "video":
      return (
        <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-4">
          {/* Repository media may contain embedded captions; no sidecar track is known here. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={sourceUrl}
            controls
            aria-label={`Preview of ${fileName}`}
            className="max-h-full max-w-full"
          />
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-8">
          {/* Repository media may contain embedded captions; no sidecar track is known here. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            src={sourceUrl}
            controls
            aria-label={`Preview of ${fileName}`}
            className="w-full max-w-2xl"
          />
        </div>
      );
    case "unsupported":
      return null;
  }
}
