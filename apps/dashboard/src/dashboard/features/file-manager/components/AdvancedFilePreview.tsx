"use client";

import { useEffect, useMemo, useState } from "react";
import FlyfishFileViewer, {
  type ViewerState,
} from "@file-viewer/react";
import { useFileManagerColorScheme } from "../lib/color-scheme";
import { flyfishRenderer } from "../lib/flyfish-preview-adapter";
import type { AdvancedFileRenderer } from "../lib/advanced-file-preview";
import { createFilePreviewFile } from "../lib/file-preview-source";

interface AdvancedFilePreviewProps {
  base64Content: string;
  fileName: string;
  renderer: AdvancedFileRenderer;
}

export function AdvancedFilePreview({
  base64Content,
  fileName,
  renderer,
}: AdvancedFilePreviewProps) {
  const theme = useFileManagerColorScheme();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const file = useMemo(
    () =>
      createFilePreviewFile(
        base64Content,
        fileName,
        "application/octet-stream",
      ),
    [base64Content, fileName],
  );

  useEffect(() => setStatus("loading"), [file]);

  if (status === "error") {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        This file could not be previewed.
      </div>
    );
  }

  return (
    <FlyfishFileViewer
      file={file}
      aria-label={`Preview of ${fileName}`}
      aria-busy={status !== "ready"}
      data-preview-status={status}
      className="h-full w-full overflow-hidden rounded-xl border border-border bg-card"
      options={{
        renderers: flyfishRenderer(renderer),
        rendererMode: "replace",
        builtinRenderers: "none",
        autoRenderers: false,
        styleIsolation: "shadow",
        theme: theme === "light" ? "light" : "dark",
        toolbar: false,
        archive:
          renderer === "archive"
            ? {
                cache: false,
                entryActions: { download: false },
                maxArchiveSize: 25 * 1024 * 1024,
                maxEntryPreviewSize: 2 * 1024 * 1024,
                workerUrl: "/vendor/libarchive/worker-bundle.js",
                wasmUrl: "/vendor/libarchive/libarchive.wasm",
                workerTimeoutMs: 15_000,
              }
            : undefined,
      }}
      onStateChange={(state: ViewerState) => {
        if (state.error) {
          setStatus("error");
        } else if (state.ready) {
          setStatus("ready");
        }
      }}
    />
  );
}
