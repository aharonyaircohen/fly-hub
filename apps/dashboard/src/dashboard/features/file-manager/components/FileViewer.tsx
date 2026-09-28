/**
 * @fileType component
 * @domain files
 * @pattern file-viewer
 * @ai-summary Polished read-only file workspace with Markdown preview,
 *   source view, metadata, copy, and history actions.
 */
"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";
import {
  Code2,
  Copy,
  Eye,
  FileQuestion,
  FileText,
  History,
  Loader2,
  PanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import { monacoLanguage } from "../lib/repo-files-lang";
import { useFilesTransport } from "../lib/transport";
import { MarkdownPreview } from "@kody-ade/base/markdown/MarkdownPreview";
import {
  autoDirProps,
  rtlAwareMarkdownClassName,
} from "../lib/text-direction";
import { useFileManagerColorScheme } from "../lib/color-scheme";
import { createLatestRequestGuard } from "../lib/latest-request";
import { filePreview } from "../lib/file-preview";
import {
  advancedFilePreview,
  canPreviewAdvancedFile,
} from "../lib/advanced-file-preview";
import { useFilePreviewUrl } from "../lib/use-file-preview-url";
import { NativeFilePreview } from "./NativeFilePreview";
import { FileLoadingState } from "./FileLoadingState";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
) as React.ComponentType<EditorProps>;

const AdvancedFilePreview = dynamic(
  () => import("./AdvancedFilePreview").then((mod) => mod.AdvancedFilePreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

interface FileViewerProps {
  path: string;
  sha: string;
  onViewDiff?: () => void;
  onShowFilePanel?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function FileViewer({
  path,
  sha,
  onViewDiff,
  onShowFilePanel,
}: FileViewerProps) {
  const theme = useFileManagerColorScheme();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [base64Content, setBase64Content] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const requestGuard = useMemo(() => createLatestRequestGuard(), []);
  const transport = useFilesTransport();

  const loadContent = useCallback(async () => {
    if (!transport || !path) return;
    const requestId = requestGuard.next();
    setLoading(true);
    setError(null);
    setContent(null);
    setBase64Content("");
    setIsBinary(false);
    setFileSize(0);
    try {
      const file = await transport.readFile(path);
      if (!requestGuard.isCurrent(requestId)) return;
      if (!file) {
        setError("File not found");
        return;
      }
      setIsBinary(file.isBinary);
      setBase64Content(file.base64Content);
      setFileSize(file.size);
      setContent(file.content);
    } catch (err) {
      if (!requestGuard.isCurrent(requestId)) return;
      setError(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      if (requestGuard.isCurrent(requestId)) setLoading(false);
    }
  }, [transport, path, requestGuard]);

  useEffect(() => {
    void loadContent();
    return () => requestGuard.invalidate();
  }, [loadContent, requestGuard]);

  const handleCopy = () => {
    if (!content) return;
    void navigator.clipboard.writeText(content).then(() => {
      toast.success("Copied to clipboard");
    });
  };

  const fileName = path.split("/").pop() ?? path;
  const parentPath = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "Repository root";
  const isMarkdown = path.endsWith(".md") || path.endsWith(".mdx");
  const preview = filePreview(path);
  const advancedPreview = advancedFilePreview(path);
  const previewUrl = useFilePreviewUrl(preview, base64Content);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex min-h-[4.75rem] shrink-0 items-center gap-5 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/15 bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {onShowFilePanel ? (
                <Button
                  variant="ghost"
                  size="clear"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onShowFilePanel}
                  title="Show file panel"
                  aria-label="Show file panel"
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              ) : null}
              <h2 className="truncate text-lg font-semibold tracking-tight">
                {fileName}
              </h2>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {parentPath}
            </p>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isMarkdown && !isBinary ? (
            <div className="mr-2 flex items-center rounded-xl border border-border bg-muted/40 p-1">
              <Button
                variant="ghost"
                size="clear"
                className={cn(
                  "flex items-center rounded-lg px-2 py-1.5",
                  !showSource
                    ? "bg-background text-foreground hover:bg-background hover:text-foreground"
                    : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
                onClick={() => setShowSource(false)}
                title="Preview"
                aria-label="Preview"
              >
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="clear"
                className={cn(
                  "flex items-center rounded-lg px-2 py-1.5",
                  showSource
                    ? "bg-background text-foreground hover:bg-background hover:text-foreground"
                    : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
                onClick={() => setShowSource(true)}
                title="Source"
                aria-label="Source"
              >
                <Code2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="clear"
            onClick={handleCopy}
            disabled={isBinary}
            className="flex items-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Copy file content"
            aria-label="Copy file content"
          >
            <Copy className="h-4 w-4" />
          </Button>
          {onViewDiff ? (
            <Button
              variant="ghost"
              size="clear"
              onClick={onViewDiff}
              className="flex items-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="History"
              aria-label="History"
            >
              <History className="h-4 w-4" />
            </Button>
          ) : null}
          <span className="ml-1 text-xs text-muted-foreground">
            {formatBytes(fileSize)}
            {sha ? ` · ${sha.slice(0, 7)}` : ""}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-muted/20 p-3">
        {loading ? (
          <FileLoadingState fileName={fileName} />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <FileQuestion className="mb-2 h-8 w-8" />
            <span>{error}</span>
          </div>
        ) : preview.kind !== "unsupported" && previewUrl ? (
          <NativeFilePreview
            fileName={fileName}
            preview={preview}
            sourceUrl={previewUrl}
          />
        ) : advancedPreview &&
          isBinary &&
          base64Content &&
          canPreviewAdvancedFile(fileSize) ? (
          <AdvancedFilePreview
            base64Content={base64Content}
            fileName={fileName}
            renderer={advancedPreview.renderer}
          />
        ) : isBinary ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <FileQuestion className="mb-2 h-8 w-8" />
            <span>Binary files can be downloaded but not edited here.</span>
          </div>
        ) : content && isMarkdown && !showSource ? (
          <div className="h-full overflow-y-auto rounded-xl border border-border bg-card">
            <div className="mx-auto max-w-4xl px-10 py-12 lg:px-16">
              <MarkdownPreview
                {...autoDirProps}
                content={content}
                className={cn(
                  "break-words text-start md:prose-lg",
                  rtlAwareMarkdownClassName,
                )}
              />
            </div>
          </div>
        ) : content ? (
          <div className="h-full overflow-hidden rounded-xl border border-border bg-card">
            <MonacoEditor
              height="100%"
              language={monacoLanguage(path)}
              value={content}
              theme={theme === "light" ? "light" : "vs-dark"}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                fontSize: 15,
                lineHeight: 24,
                padding: { top: 24, bottom: 24 },
                renderLineHighlight: "none",
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                wordWrap: "on",
                automaticLayout: true,
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
