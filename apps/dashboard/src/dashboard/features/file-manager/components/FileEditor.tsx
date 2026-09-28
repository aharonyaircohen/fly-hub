/**
 * @fileType component
 * @domain files
 * @pattern file-editor
 * @ai-summary Editable Monaco Editor for the /files page. Supports
 *   view / edit mode, unsaved changes indicator, and Ctrl+S save.
 */
"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { EditorProps } from "@monaco-editor/react";
import {
  Save,
  Undo2,
  Loader2,
  Eye,
  Edit3,
  FileText,
  PanelLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import { monacoLanguage } from "../lib/repo-files-lang";
import { useFilesTransport } from "../lib/transport";
import { MarkdownEditor } from "@kody-ade/base/markdown/MarkdownEditor";
import { useFileManagerColorScheme } from "../lib/color-scheme";
import { createLatestRequestGuard } from "../lib/latest-request";
import {
  fileDraftStorageKey,
  parseFileDraft,
  serializeFileDraft,
} from "../lib/file-drafts";
import { isHtmlFile } from "../lib/html-preview";
import { HtmlPreview } from "./HtmlPreview";
import {
  advancedFilePreview,
  canPreviewAdvancedFile,
} from "../lib/advanced-file-preview";
import { stringToBase64 } from "../lib/file-content";

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.Editor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
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
      <div className="flex h-full flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export type FileEditorMode = "edit" | "view";

interface FileEditorProps {
  path: string;
  sha: string;
  onShowFilePanel?: () => void;
  defaultMode?: FileEditorMode;
  onContentChange?: (content: string, isDirty: boolean) => void;
}

export function FileEditor({
  path,
  sha,
  onShowFilePanel,
  defaultMode = "edit",
  onContentChange,
}: FileEditorProps) {
  const theme = useFileManagerColorScheme();
  const [originalContent, setOriginalContent] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<FileEditorMode>(defaultMode);
  const [isDirty, setIsDirty] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [loadedSha, setLoadedSha] = useState(sha);
  const requestGuard = useMemo(() => createLatestRequestGuard(), []);
  const transport = useFilesTransport();

  const isMarkdown = path.endsWith(".md") || path.endsWith(".mdx");
  const isHtml = isHtmlFile(path);
  const advancedPreview = advancedFilePreview(path);
  const supportsView = isMarkdown || isHtml || advancedPreview !== null;
  const advancedPreviewSource = useMemo(
    () => (advancedPreview ? stringToBase64(content) : ""),
    [advancedPreview, content],
  );
  const advancedPreviewSize = useMemo(
    () => (advancedPreview ? new TextEncoder().encode(content).byteLength : 0),
    [advancedPreview, content],
  );
  const draftStorageKey = useMemo(
    () => fileDraftStorageKey(transport?.cacheKey ?? "workspace", path),
    [transport?.cacheKey, path],
  );

  // Load file content on mount
  useEffect(() => {
    if (!transport || !path) return;
    const requestId = requestGuard.next();

    const load = async () => {
      setLoading(true);
      setDraftReady(false);
      setError(null);
      try {
        const file = await transport.readFile(path);
        if (!requestGuard.isCurrent(requestId)) return;
        if (!file) {
          setError("File not found");
          return;
        }
        if (file.isBinary) {
          setError("Binary files cannot be edited");
          return;
        }
        setLoadedSha(file.sha);
        setOriginalContent(file.content);
        const storedDraft = localStorage.getItem(draftStorageKey);
        if (storedDraft) {
          const draft = parseFileDraft(storedDraft);
          if (!draft) {
            localStorage.removeItem(draftStorageKey);
            setContent(file.content);
          } else {
            setContent(draft.content);
            if (draft.baseSha !== file.sha) {
              toast.info(
                "Recovered a local draft based on an older file revision.",
              );
            }
          }
        } else {
          setContent(file.content);
        }
        setDraftReady(true);
      } catch (err) {
        if (!requestGuard.isCurrent(requestId)) return;
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        if (requestGuard.isCurrent(requestId)) setLoading(false);
      }
    };
    void load();

    return () => {
      if (requestGuard.isCurrent(requestId)) requestGuard.invalidate();
    };
  }, [transport, path, draftStorageKey, requestGuard]);

  useEffect(() => {
    setMode(supportsView ? defaultMode : "edit");
  }, [defaultMode, path, supportsView]);

  // Track dirty state
  useEffect(() => {
    setIsDirty(content !== originalContent);
  }, [content, originalContent]);

  useEffect(() => {
    if (!draftReady) return;
    onContentChange?.(content, content !== originalContent);
  }, [content, draftReady, onContentChange, originalContent]);

  useEffect(() => {
    if (!draftReady) return;

    if (content === originalContent) {
      localStorage.removeItem(draftStorageKey);
      return;
    }

    const persistDraft = () => {
      try {
        localStorage.setItem(
          draftStorageKey,
          serializeFileDraft({
            content,
            baseSha: loadedSha,
            updatedAt: Date.now(),
          }),
        );
      } catch {
        // Editing must continue even if browser storage is unavailable.
      }
    };
    const timeout = window.setTimeout(persistDraft, 300);
    window.addEventListener("beforeunload", persistDraft);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("beforeunload", persistDraft);
      persistDraft();
    };
  }, [content, draftReady, draftStorageKey, loadedSha, originalContent]);

  // Keyboard shortcut: Ctrl+S / Cmd+S to save
  const handleEditorChange = useCallback((value: string | undefined) => {
    setContent(value ?? "");
  }, []);

  const handleSave = useCallback(async () => {
    if (!transport?.writeFile) return;
    setSaving(true);
    try {
      let nextSha = loadedSha;
      const result = await transport.writeFile(path, content, {
        expectedVersion: loadedSha,
      });
      nextSha = result?.version ?? loadedSha;
      localStorage.removeItem(draftStorageKey);
      setLoadedSha(nextSha);
      setOriginalContent(content);
      setIsDirty(false);
      toast.success("File saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [transport, path, content, loadedSha, draftStorageKey]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          void handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isDirty, saving]);

  const handleDiscard = useCallback(() => {
    const confirmed = window.confirm(
      "Discard unsaved changes? This cannot be undone.",
    );
    if (!confirmed) return;

    localStorage.removeItem(draftStorageKey);
    setContent(originalContent);
    setIsDirty(false);
  }, [draftStorageKey, originalContent]);

  const fileName = path.split("/").pop() ?? path;
  const parentPath = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/"))
    : "Repository root";

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
              {isDirty && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.68rem] font-medium uppercase tracking-wider text-primary">
                  Unsaved
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {parentPath}
            </p>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {supportsView ? (
            <div className="mr-2 flex items-center rounded-xl border border-border bg-muted/40 p-1">
              <Button
                variant="ghost"
                size="clear"
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg",
                  mode === "edit"
                    ? "bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground"
                    : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
                onClick={() => setMode("edit")}
                title="Edit mode"
                aria-label="Edit mode"
                aria-pressed={mode === "edit"}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="clear"
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-lg",
                  mode === "view"
                    ? "bg-background text-foreground shadow-sm hover:bg-background hover:text-foreground"
                    : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
                onClick={() => setMode("view")}
                title="View mode"
                aria-label="View mode"
                aria-pressed={mode === "view"}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
          ) : null}

          {isDirty ? (
            <Button
              variant="ghost"
              size="clear"
              onClick={handleDiscard}
              className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Discard unsaved changes"
              aria-label="Discard unsaved changes"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          ) : null}

          <Button
            variant="default"
            size="clear"
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
            title="Save changes"
            aria-label="Save changes"
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90",
              (!isDirty || saving) &&
                "cursor-not-allowed bg-muted text-muted-foreground hover:bg-muted",
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 bg-muted/20 p-3">
        {loading ? (
          <div className="flex items-center justify-center w-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex w-full flex-col items-center justify-center text-muted-foreground">
            <span>{error}</span>
          </div>
        ) : isMarkdown ? (
          <MarkdownEditor
            key={path}
            value={content}
            onChange={setContent}
            mode={mode === "edit" ? "write" : "preview"}
            showModeControls={false}
            showToolbar={mode === "edit"}
            fillHeight
            textareaAriaLabel="Editor content"
            className="min-h-0 flex-1 rounded-xl border border-border bg-card p-3 shadow-sm"
            textareaClassName="w-full"
          />
        ) : mode === "edit" ? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <MonacoEditor
              height="100%"
              language={monacoLanguage(path)}
              value={content}
              theme={theme === "light" ? "light" : "vs-dark"}
              onChange={handleEditorChange}
              options={{
                readOnly: false,
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
        ) : advancedPreview &&
          advancedPreviewSource &&
          canPreviewAdvancedFile(advancedPreviewSize) ? (
          <AdvancedFilePreview
            base64Content={advancedPreviewSource}
            fileName={fileName}
            renderer={advancedPreview.renderer}
          />
        ) : advancedPreview ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
            This file is too large for a formatted browser preview.
          </div>
        ) : null}

        {mode === "view" && isHtml ? (
          <HtmlPreview
            className="min-h-0 flex-1 rounded-xl border border-border"
            content={content}
            fileName={fileName}
          />
        ) : null}
      </div>
    </div>
  );
}
