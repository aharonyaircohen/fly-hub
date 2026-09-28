/**
 * @fileType component
 * @domain kody
 * @pattern credential-update-dialog
 * @ai-summary Replaces a connected repository's GitHub PAT. The repository
 *   connection endpoint validates it, updates encrypted background access,
 *   and repairs the webhook before auth-context persists the browser copy.
 */
"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Input } from "@kody-ade/base/ui/input";
import { Label } from "@kody-ade/base/ui/label";
import { type KodyRepoEntry, useAuth } from "../auth-context";
import type { AddRepoResponse } from "./AddRepoForm";

interface UpdatePatDialogProps {
  target: { entry: KodyRepoEntry; index: number } | null;
  onOpenChange: (open: boolean) => void;
}

export function UpdatePatDialog({
  target,
  onOpenChange,
}: UpdatePatDialogProps) {
  const { replaceRepoToken } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setToken("");
    setError(null);
    setSubmitting(false);
  }, [target]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Personal access token is required.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/kody/repos/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: target.entry.owner,
          repo: target.entry.repo,
          token: trimmedToken,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AddRepoResponse;
      if (!response.ok || !data.ok) {
        setError(data.message || data.error || `Failed (${response.status})`);
        return;
      }

      if (!replaceRepoToken(target.index, trimmedToken, data.user)) {
        setError("Repository connection changed. Close this dialog and retry.");
        return;
      }

      toast.success("PAT updated", {
        description: data.webhook.ok
          ? "GitHub access, background automation, and webhook verified."
          : "GitHub access and background automation verified, but webhook repair needs attention.",
      });
      onOpenChange(false);
      window.location.reload();
    } catch {
      setError("Could not reach GitHub. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update PAT</DialogTitle>
          <DialogDescription>
            Replace GitHub access for {target?.entry.owner}/{target?.entry.repo}
            .
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="replacement-pat">New personal access token</Label>
            <div className="relative">
              <KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="replacement-pat"
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="pl-9"
                required
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !token.trim()}>
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
