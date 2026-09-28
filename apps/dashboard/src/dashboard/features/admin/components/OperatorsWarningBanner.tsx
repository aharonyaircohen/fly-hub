/**
 * @fileType component
 * @domain kody
 * @pattern operators-warning-banner
 * @ai-summary Surfaced at the top of the inbox: warns when the connected
 *   repo has no operators set (`github.operators` empty), because that means
 *   recommendation capabilities post but @-mention no one, so the inbox silently
 *   stays empty. One-click "add me" for the signed-in user, plus a link to
 *   the Config page for the full list. Renders nothing while loading or when
 *   at least one operator exists.
 */
"use client";

import { Button } from "@kody-ade/base/ui/button";
import { RepoScopedLink } from "@dashboard/lib/components/RepoScopedLink";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { useOperators } from "@dashboard/lib/operators/useOperators";

export function OperatorsWarningBanner() {
  const { operators, loading, saving, meLogin, add } = useOperators();

  if (loading || operators.length > 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-amber-200">No operators set</p>
          <p className="text-xs text-amber-100/70 mt-1">
            Recommendations are being posted but @-mention no one, so they never
            reach this inbox. Set who should receive them in{" "}
            <RepoScopedLink href="/config" className="underline">
              Config
            </RepoScopedLink>
            .
          </p>
          {meLogin && (
            <Button
              type="button"
              variant="ghost"
              size="clear"
              disabled={saving}
              onClick={() => {
                void add(meLogin).catch(() =>
                  toast.error("Couldn't save operators"),
                );
              }}
              className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-normal text-amber-100 hover:bg-amber-500/20 hover:text-amber-100 disabled:opacity-50"
            >
              {saving ? "Saving…" : `Set me (@${meLogin}) as operator`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
