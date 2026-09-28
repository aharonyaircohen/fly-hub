/**
 * @fileType component
 * @domain kody
 * @pattern chat-issue-report-dialog
 * @ai-summary One-input issue report flow for Kody chat. Files into the
 *   kody-chat repo with browser diagnostics plus chat-local captured state.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { Label } from "@kody-ade/base/ui/label";
import { Textarea } from "@kody-ade/base/ui/textarea";
import {
  kodyApi,
  redirectToLogin,
  SessionExpiredError,
} from "../integration-api";
import { useGitHubIdentity } from "../hooks/useGitHubIdentity";

export interface ChatIssueReportState {
  sections?: Array<{
    title: string;
    items: Array<{ label: string; value: string }>;
  }>;
  recentMessages?: Array<{ role: "user" | "assistant"; text: string }>;
  recentToolCalls?: Array<{
    name: string;
    status: string;
    summary?: string;
  }>;
}

interface ChatIssueReportDialogProps {
  open: boolean;
  onClose: () => void;
  capturedState: ChatIssueReportState | null;
}

function captureDiagnostics(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const d: Record<string, string> = {
    url: window.location.href,
    timestamp: new Date().toISOString(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  };
  if (document.referrer) d.referrer = document.referrer;
  if (navigator.userAgent) d.userAgent = navigator.userAgent;
  if (navigator.platform) d.platform = navigator.platform;
  if (window.screen)
    d.screen = `${window.screen.width}x${window.screen.height}`;
  try {
    d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* optional browser detail */
  }
  return d;
}

function titleFromDescription(description: string): string {
  const firstLine = description.trim().split(/\r?\n/)[0]?.trim() ?? "";
  const normalized = firstLine.replace(/\s+/g, " ");
  if (!normalized) return "Chat issue report";
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}

function currentReturnPath(): string {
  if (typeof window === "undefined") return "/chat";
  return `${window.location.pathname}${window.location.search}`;
}

export function ChatIssueReportDialog({
  open,
  onClose,
  capturedState,
}: ChatIssueReportDialogProps) {
  const { githubUser } = useGitHubIdentity();
  const [description, setDescription] = useState("");

  const includedCount = useMemo(() => {
    const sectionItems =
      capturedState?.sections?.reduce(
        (total, section) => total + section.items.length,
        0,
      ) ?? 0;
    return (
      sectionItems +
      (capturedState?.recentMessages?.length ?? 0) +
      (capturedState?.recentToolCalls?.length ?? 0)
    );
  }, [capturedState]);

  const report = useMutation({
    mutationFn: () =>
      kodyApi.kodyBugs.report({
        title: titleFromDescription(description),
        area: "chat",
        severity: "major",
        whatHappened: description,
        where: "Kody chat",
        reporterLogin: githubUser?.login,
        diagnostics: captureDiagnostics(),
        capturedState: capturedState ?? undefined,
        source: "kody-chat",
      }),
    onError: (error) => {
      if (error instanceof SessionExpiredError) {
        redirectToLogin(currentReturnPath());
      }
    },
  });
  const resetReport = report.reset;

  useEffect(() => {
    if (!open) {
      setDescription("");
      resetReport();
    }
  }, [open, resetReport]);

  const created = report.data?.issue;
  const canSubmit = description.trim().length > 0 && !report.isPending;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>Report issue to Kody</DialogTitle>
          <DialogDescription>
            Tell us what went wrong. The current chat state is attached.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="grid gap-4 py-5 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <div>
              <p className="font-medium">Report filed.</p>
              <p className="text-sm text-muted-foreground">
                Kody issue #{created.number}
              </p>
            </div>
            <div className="flex gap-3">
              <a
                href={created.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1"
              >
                <Button variant="outline" className="w-full gap-2">
                  <ExternalLink className="h-4 w-4" />
                  View
                </Button>
              </a>
              <Button type="button" className="flex-1" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="grid gap-4 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) report.mutate();
            }}
          >
            {report.error && (
              <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                {report.error.message}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="chat-issue-description">What went wrong?</Label>
              <Textarea
                id="chat-issue-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the issue in one or two sentences."
                rows={5}
                autoFocus
                required
              />
            </div>

            <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Included state ({includedCount})
              </summary>
              <div className="mt-2 max-h-44 space-y-3 overflow-y-auto text-xs text-muted-foreground">
                {capturedState?.sections?.map((section) => (
                  <div key={section.title}>
                    <div className="font-medium text-foreground">
                      {section.title}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {section.items.map((item) => (
                        <li key={`${section.title}-${item.label}`}>
                          {item.label}: {item.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {capturedState?.recentToolCalls?.length ? (
                  <div>
                    <div className="font-medium text-foreground">
                      Recent tool calls
                    </div>
                    <ul className="mt-1 space-y-1">
                      {capturedState.recentToolCalls.map((tool, index) => (
                        <li key={`${tool.name}-${index}`}>
                          {tool.name}: {tool.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {capturedState?.recentMessages?.length ? (
                  <div>
                    <div className="font-medium text-foreground">
                      Recent messages
                    </div>
                    <ul className="mt-1 space-y-1">
                      {capturedState.recentMessages.map((message, index) => (
                        <li key={`${message.role}-${index}`}>
                          {message.role}: {message.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={!canSubmit}>
                {report.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reporting
                  </>
                ) : (
                  "Report"
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
