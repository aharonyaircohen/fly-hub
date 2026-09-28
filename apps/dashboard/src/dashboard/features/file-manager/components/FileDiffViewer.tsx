/**
 * @fileType component
 * @domain files
 * @pattern file-diff-viewer
 * @ai-summary Monaco DiffEditor for comparing file versions between commits.
 *   Shows a list of recent commits and allows selecting two to compare.
 */
"use client";

import React, { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import type { DiffEditorProps } from "@monaco-editor/react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import { cn } from "@kody-ade/base/utils/ui";
import { useFileManagerColorScheme } from "../lib/color-scheme";
import type { CommitInfo } from "../lib/repo-files";
import { useFilesTransport } from "../lib/transport";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
) as React.ComponentType<DiffEditorProps>;

interface FileDiffViewerProps {
  path: string;
  onClose: () => void;
}

export function FileDiffViewer({ path, onClose }: FileDiffViewerProps) {
  const theme = useFileManagerColorScheme();
  const transport = useFilesTransport();
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [leftCommit, setLeftCommit] = useState<CommitInfo | null>(null);
  const [rightCommit, setRightCommit] = useState<CommitInfo | null>(null);
  const [leftContent, setLeftContent] = useState<string>("");
  const [rightContent, setRightContent] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(false);

  // Load commit history
  useEffect(() => {
    if (!transport?.history) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const history = await transport.history!(path, 20);
        setCommits(history);
        if (history.length >= 2) {
          setLeftCommit(history[1]);
          setRightCommit(history[0]);
        } else if (history.length === 1) {
          setLeftCommit(history[0]);
          setRightCommit(null);
        }
      } catch (err) {
        console.error("Failed to load commit history", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [transport, path]);

  // Load content for selected commits
  const loadDiffContent = useCallback(async () => {
    if (!transport?.readVersion || !leftCommit || !rightCommit) return;
    setLoadingContent(true);
    try {
      const [left, right] = await Promise.all([
        transport.readVersion(path, leftCommit.sha),
        transport.readVersion(path, rightCommit.sha),
      ]);
      setLeftContent(left?.content ?? "");
      setRightContent(right?.content ?? "");
    } catch (err) {
      console.error("Failed to load diff content", err);
    } finally {
      setLoadingContent(false);
    }
  }, [transport, path, leftCommit, rightCommit]);

  // Load diff when commits change
  useEffect(() => {
    loadDiffContent();
  }, [loadDiffContent]);

  const handleCopyDiff = () => {
    const diff = `--- a/${path}\n+++ b/${path}\n${rightContent}`;
    navigator.clipboard.writeText(diff).then(() => {
      toast.success("Diff copied to clipboard");
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2 shrink-0">
        <span className="text-sm font-medium truncate">{path}</span>
        <span className="text-xs text-muted-foreground">Diff view</span>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="clear"
            onClick={handleCopyDiff}
            className={cn(
              "flex items-center gap-1.5 text-xs font-normal px-2 py-1 rounded",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy diff
          </Button>
          <Button
            variant="ghost"
            size="clear"
            onClick={onClose}
            className={cn(
              "text-xs font-normal px-2 py-1 rounded",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Commit selector */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Compare:</span>
          <select
            value={leftCommit?.sha ?? ""}
            onChange={(e) => {
              const sha = e.target.value;
              setLeftCommit(commits.find((c) => c.sha === sha) ?? null);
            }}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {c.sha} — {c.message.slice(0, 40)}
              </option>
            ))}
          </select>

          <span className="text-muted-foreground">→</span>

          <select
            value={rightCommit?.sha ?? ""}
            onChange={(e) => {
              const sha = e.target.value;
              setRightCommit(commits.find((c) => c.sha === sha) ?? null);
            }}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          >
            {commits.map((c) => (
              <option key={c.sha} value={c.sha}>
                {c.sha} — {c.message.slice(0, 40)}
              </option>
            ))}
          </select>
        </div>

        {loadingContent && (
          <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Diff editor */}
      <div className="flex-1 min-h-0">
        {leftContent && rightContent ? (
          <DiffEditor
            height="100%"
            language="plaintext"
            original={leftContent}
            modified={rightContent}
            theme={theme === "dark" ? "vs-dark" : "light"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              fontSize: 13,
              automaticLayout: true,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <span>Select two commits to compare</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
