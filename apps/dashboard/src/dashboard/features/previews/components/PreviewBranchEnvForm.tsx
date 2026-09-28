/**
 * @fileType component
 * @domain preview
 * @pattern controlled-form
 * @ai-summary Small repo + branch form for saving a Fly branch preview as a
 *   preview workspace environment. The repo is fixed to the connected repo;
 *   the saved entry stores identity only, not the signed preview URL.
 */
"use client";

import { useState } from "react";
import { Button } from "@kody-ade/base/ui/button";
import { Input } from "@kody-ade/base/ui/input";
import { GitBranch, Loader2, Save } from "lucide-react";

import { normalizeBranchName, normalizeRepoRef } from "@kody-ade/fly/preview-environments";

interface PreviewBranchEnvFormProps {
  repoFullName: string;
  initialBranch?: string;
  submitLabel?: string;
  isSaving?: boolean;
  onSubmit: (repo: string, branch: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function PreviewBranchEnvForm({
  repoFullName,
  initialBranch = "",
  submitLabel = "Add",
  isSaving = false,
  onSubmit,
  onCancel,
}: PreviewBranchEnvFormProps) {
  const [branch, setBranch] = useState(initialBranch);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const repo = normalizeRepoRef(repoFullName);
    const cleanBranch = normalizeBranchName(branch);
    if (!repo) {
      setError("Connected repo is invalid");
      return;
    }
    if (!cleanBranch) {
      setError("Enter a valid branch");
      return;
    }

    try {
      await onSubmit(repo, cleanBranch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Input
        type="text"
        value={repoFullName}
        disabled
        aria-label="Repository"
      />
      <Input
        type="text"
        placeholder="Branch (e.g. dev)"
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        disabled={isSaving}
        maxLength={255}
        aria-label="Branch"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving} className="gap-1.5">
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {isSaving ? "Saving..." : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
        )}
        <GitBranch className="ml-auto h-3.5 w-3.5 text-zinc-500" />
      </div>
    </form>
  );
}
