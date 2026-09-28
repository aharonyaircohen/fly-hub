"use client";
/**
 * @fileType component
 * @domain kody
 * @pattern capability-trust-card
 * @ai-summary Trust section for one capability's detail page. Observe/verify
 *   capabilities run freely (badge only). Act capabilities get ONE control with
 *   three modes: Earn trust (default ask→auto path, streak preserved), Always
 *   ask (neverAuto pin — pauses auto without losing progress), Auto (trusted
 *   now). No separate level toggle + pin checkbox — one choice, one meaning.
 */
import {
  Eye,
  GraduationCap,
  Loader2,
  Lock,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";

import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";

import {
  TRUST_GRADUATION_THRESHOLD,
  trustSubjectKey,
} from "@dashboard/lib/cto/trust-state";
import { useTrust } from "@dashboard/lib/cto/useTrust";
import { cn } from "@dashboard/lib/utils";

type TrustChoice = "earn" | "always-ask" | "auto";

const choices: Array<{
  value: TrustChoice;
  label: string;
  hint: string;
  Icon: typeof GraduationCap;
  activeClassName: string;
}> = [
  {
    value: "earn",
    label: "Earn trust",
    hint: "Asks for approval; goes auto after a clean streak.",
    Icon: GraduationCap,
    activeClassName:
      "border-amber-500/40 bg-amber-500/15 text-amber-200",
  },
  {
    value: "always-ask",
    label: "Always ask",
    hint: "Never goes auto. Progress is kept — switch back anytime.",
    Icon: Lock,
    activeClassName: "border-red-500/40 bg-red-500/15 text-red-200",
  },
  {
    value: "auto",
    label: "Auto",
    hint: "Runs without asking, starting now.",
    Icon: ShieldCheck,
    activeClassName:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  },
];

export function CapabilityTrustCard({
  slug,
  capabilityKind,
}: {
  slug: string;
  capabilityKind?: "observe" | "act" | "verify" | null;
}) {
  const trust = useTrust();
  const stats = trust.capabilities[slug] ?? null;
  const subjectStats =
    trust.subjects[trustSubjectKey("capability", slug)] ?? null;
  const runsFreely =
    capabilityKind === "observe" || capabilityKind === "verify";
  const neverAuto =
    stats?.neverAuto === true || subjectStats?.neverAuto === true;
  const current: TrustChoice = neverAuto
    ? "always-ask"
    : stats?.mode === "auto" || subjectStats?.mode === "auto"
      ? "auto"
      : "earn";
  const streak = stats?.consecutiveApprovals ?? 0;
  const remaining = Math.max(0, TRUST_GRADUATION_THRESHOLD - streak);

  if (trust.isLoading) {
    return (
      <Card className="border-white/[0.08] bg-white/[0.02]">
        <CardContent className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading trust…
        </CardContent>
      </Card>
    );
  }

  const select = (choice: TrustChoice) => {
    if (choice === current) return;
    if (choice === "always-ask") {
      void trust.setNeverAuto({ capability: slug, neverAuto: true });
      return;
    }
    void trust.setTrust({
      capability: slug,
      op: choice === "auto" ? "graduate" : "earn",
    });
  };

  return (
    <Card className="border-white/[0.08] bg-white/[0.02]">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldQuestion className="w-4 h-4 text-muted-foreground" />
            Trust
          </div>
          {runsFreely ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1">
              <Eye className="w-3.5 h-3.5" />
              {capabilityKind === "observe" ? "Observe" : "Verify"} — runs
              without approval
            </span>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {choices.map(({ value, label, Icon, activeClassName }) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={trust.isMutating}
                  onClick={() => select(value)}
                  className={cn(
                    "gap-1.5 text-xs",
                    value === current
                      ? activeClassName
                      : "text-muted-foreground",
                  )}
                  aria-pressed={value === current}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {!runsFreely ? (
          <p className="text-xs text-muted-foreground">
            {choices.find((choice) => choice.value === current)?.hint}{" "}
            {current !== "auto"
              ? streak > 0
                ? `Streak: ${streak} clean approval${streak === 1 ? "" : "s"}${current === "earn" ? `, ${remaining} more to go auto.` : "."}`
                : current === "earn"
                  ? `Goes auto after ${TRUST_GRADUATION_THRESHOLD} clean approvals.`
                  : ""
              : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
