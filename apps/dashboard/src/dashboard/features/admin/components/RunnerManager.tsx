/**
 * @fileType component
 * @domain runner
 * @pattern fly-pages
 * @ai-summary Shared Fly page shell for /fly/config, /fly/previews,
 * /fly/machines, and /fly/history. Config owns runner/Brain setup; previews
 * owns preview inventory and settings; machines owns live inventory; history
 * owns activity snapshots.
 */
"use client";

import { RepoScopedLink } from "@dashboard/lib/components/RepoScopedLink";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Cpu,
  Globe,
  Info,
  KeyRound,
  Rocket,
  Server,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import { Input } from "@kody-ade/base/ui/input";
import { FlyActivityTab } from "@dashboard/features/previews/components/FlyActivityTab";
import { FlyMachinesTable } from "@dashboard/features/previews/components/FlyMachinesTable";
import { FlyPreviewsList } from "@dashboard/features/previews/components/FlyPreviewsList";
import { PreviewsCard } from "@dashboard/features/previews/components/PreviewsCard";
import { PageShell } from "@dashboard/lib/components/PageShell";
import { SimpleTooltip } from "@dashboard/lib/components/SimpleTooltip";
import { VaultLockedBanner } from "@dashboard/lib/components/VaultLockedBanner";
import {
  buildAuthHeaders,
  useAuth,
  type FlyPerfTier,
} from "@dashboard/lib/auth-context";
import {
  useFlyTokenStatus,
  type FlyTokenStatus,
} from "@dashboard/lib/hooks/useFlyTokenStatus";

const POOL_MIN_VAULT_KEY = "POOL_MIN";
const POOL_MIN_DEFAULT = 2;
const POOL_MIN_MAX = 10;
const FLY_PERF_DEFAULT: FlyPerfTier = "medium";
const EMPTY_HEADERS: Record<string, string> = {};

const FLY_PERF_LABELS: Record<FlyPerfTier, { label: string; hint: string }> = {
  low: {
    label: "Economy",
    hint: "Cheapest (shared 2x / 2 GB). Fine for chat; installs and tests are slower.",
  },
  medium: {
    label: "Balanced",
    hint: "Default (performance 1x / 2 GB). Good for most Vibe and build-test work.",
  },
  high: {
    label: "Fast",
    hint: "Fastest (performance 2x / 4 GB). Best for heavy installs and big repos. Costs more.",
  },
};

const PERF_ORDER: FlyPerfTier[] = ["low", "medium", "high"];

const SCOPE_CHIP_HINTS = {
  wholeRepo: "Applies to everyone using this repo.",
  justYou: "Only affects this browser.",
};

export type RunnerView = "config" | "previews" | "machines" | "history";

interface RunnerManagerProps {
  view?: RunnerView;
  selectedApp?: string;
  selectedMachineId?: string;
}

const FLY_VIEW_COPY: Record<RunnerView, { title: string; subtitle: string }> = {
  config: {
    title: "Fly Config",
    subtitle: "Fly token and repository runner settings.",
  },
  previews: {
    title: "Fly Previews",
    subtitle: "Preview URLs, live machines, and PR preview settings.",
  },
  machines: {
    title: "Fly Machines",
    subtitle: "Live Fly machines and actions.",
  },
  history: {
    title: "Fly History",
    subtitle: "Past Fly machine activity from state snapshots.",
  },
};

function GroupHeader({
  icon: Icon,
  label,
  hint,
  status,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-1">
      <Icon className="w-3.5 h-3.5 text-white/40" />
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
        {label}
      </h2>
      <SimpleTooltip content={hint} side="right">
        <Info className="w-3 h-3 text-white/50 hover:text-white/80 cursor-help" />
      </SimpleTooltip>
      {status && (
        <span className="flex items-center gap-1.5 text-[10px] text-white/55 normal-case tracking-normal">
          {status}
        </span>
      )}
    </div>
  );
}

function FlyTokenCard({ status }: { status: FlyTokenStatus }) {
  const { configured, source } = status;
  const statusLabel = status.loading
    ? "Checking"
    : source === "repo-vault"
      ? "Repo token"
      : "Not configured";
  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">Fly token</h2>
          <SimpleTooltip
            side="right"
            content={
              <>
                Fly features require this repo's own token. Set{" "}
                <span className="font-mono">FLY_API_TOKEN</span> on the{" "}
                <RepoScopedLink
                  href="/secrets"
                  className="text-sky-400 hover:underline"
                >
                  Secrets
                </RepoScopedLink>{" "}
                page to give this repo its own Fly account boundary.
              </>
            }
          >
            <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
          </SimpleTooltip>
          <span
            className={`ml-auto text-[11px] ${
              configured ? "text-emerald-300" : "text-amber-300"
            }`}
          >
            {statusLabel}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function RunnerConfigView({
  flyTokenStatus,
  headers,
}: {
  flyTokenStatus: FlyTokenStatus;
  headers: Record<string, string>;
}) {
  const { auth, updateIntegrations } = useAuth();
  const [poolMin, setPoolMin] = useState("");
  const [poolMinSaved, setPoolMinSaved] = useState("");
  const [poolMinSaving, setPoolMinSaving] = useState(false);
  const [flyPerf, setFlyPerf] = useState<FlyPerfTier>(FLY_PERF_DEFAULT);

  const loadPoolMin = useCallback(async () => {
    if (Object.keys(headers).length === 0) {
      setPoolMin("");
      setPoolMinSaved("");
      return;
    }
    try {
      const res = await fetch(`/api/kody/secrets/${POOL_MIN_VAULT_KEY}/value`, {
        headers,
      });
      if (!res.ok) {
        setPoolMin("");
        setPoolMinSaved("");
        return;
      }
      const body = (await res.json()) as { value?: string };
      const v = body.value ?? "";
      setPoolMin(v);
      setPoolMinSaved(v);
    } catch {
      setPoolMin("");
      setPoolMinSaved("");
    }
  }, [headers]);

  useEffect(() => {
    void loadPoolMin();
  }, [loadPoolMin]);

  useEffect(() => {
    setFlyPerf(auth?.flyPerf ?? FLY_PERF_DEFAULT);
  }, [auth?.flyPerf]);

  const poolMinHasChanges = poolMin.trim() !== poolMinSaved.trim();
  const flyHasChanges = flyPerf !== (auth?.flyPerf ?? FLY_PERF_DEFAULT);

  function saveFly() {
    updateIntegrations({
      flyPerf: flyPerf === FLY_PERF_DEFAULT ? null : flyPerf,
    });
    toast.success("Fly performance tier saved");
  }

  async function savePoolMin() {
    const n = Number(poolMin.trim());
    if (!Number.isInteger(n) || n < 0 || n > POOL_MIN_MAX) {
      toast.error(
        `Warm pool size must be a whole number from 0 to ${POOL_MIN_MAX}`,
      );
      return;
    }
    setPoolMinSaving(true);
    try {
      const res = await fetch(`/api/kody/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ name: POOL_MIN_VAULT_KEY, value: String(n) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      setPoolMinSaved(String(n));
      setPoolMin(String(n));
      toast.success("Warm pool size saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPoolMinSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <FlyTokenCard status={flyTokenStatus} />

      {flyTokenStatus.configured && (
        <>
          <section className="space-y-3">
            <GroupHeader
              icon={Server}
              label="Task runners"
              hint="machines that run chat and Vibe tasks"
            />
            <Card className="border-white/[0.08] bg-white/[0.03]">
              <CardContent className="p-4 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Warm pool size</h2>
                    <SimpleTooltip
                      content="How many pre-warmed runner machines to keep ready for this repo."
                      side="right"
                    >
                      <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
                    </SimpleTooltip>
                    <SimpleTooltip
                      content={SCOPE_CHIP_HINTS.wholeRepo}
                      side="bottom"
                    >
                      <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide cursor-help">
                        whole repo
                      </span>
                    </SimpleTooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={poolMin}
                      onChange={(e) => setPoolMin(e.target.value)}
                      placeholder={String(POOL_MIN_DEFAULT)}
                      inputMode="numeric"
                      className="w-24"
                    />
                    <Button
                      size="sm"
                      onClick={savePoolMin}
                      disabled={!poolMinHasChanges || poolMinSaving}
                    >
                      Save pool
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-sky-400" />
                    <h2 className="text-sm font-semibold">Speed of my runs</h2>
                    <SimpleTooltip
                      content="Pick the VM size for your chat and Vibe runs. Hover each tier for the spec."
                      side="right"
                    >
                      <Info className="w-3.5 h-3.5 text-white/50 hover:text-white/80 cursor-help" />
                    </SimpleTooltip>
                    <SimpleTooltip
                      content={SCOPE_CHIP_HINTS.justYou}
                      side="bottom"
                    >
                      <span className="ml-auto text-[10px] text-white/35 uppercase tracking-wide cursor-help">
                        just you
                      </span>
                    </SimpleTooltip>
                  </div>
                  <div className="flex gap-1.5">
                    {PERF_ORDER.map((tier) => {
                      const active = flyPerf === tier;
                      return (
                        <Button
                          key={tier}
                          type="button"
                          size="clear"
                          variant="ghost"
                          onClick={() => setFlyPerf(tier)}
                          title={FLY_PERF_LABELS[tier].hint}
                          className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-normal transition ${
                            active
                              ? "border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/15 hover:text-sky-200"
                              : "border-white/10 bg-black/20 text-white/60 hover:bg-black/20 hover:text-white/80"
                          }`}
                        >
                          {FLY_PERF_LABELS[tier].label}
                        </Button>
                      );
                    })}
                  </div>
                  <Button size="sm" onClick={saveFly} disabled={!flyHasChanges}>
                    Save my speed
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function FlyPreviewsView({
  flyTokenConfigured,
  headers,
}: {
  flyTokenConfigured: boolean;
  headers: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      {flyTokenConfigured && (
        <section className="space-y-3">
          <GroupHeader
            icon={SlidersHorizontal}
            label="Preview settings"
            hint="PR preview size, cleanup, and manual branch previews"
          />
          <PreviewsCard
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        </section>
      )}

      <section className="space-y-3">
        <GroupHeader
          icon={Globe}
          label="Preview machines"
          hint="live preview URLs and machine details"
        />
        <FlyPreviewsList
          headers={headers}
          flyTokenConfigured={flyTokenConfigured}
        />
      </section>
    </div>
  );
}

export function RunnerManager({
  view = "config",
  selectedApp,
  selectedMachineId,
}: RunnerManagerProps) {
  const { auth } = useAuth();
  const headers = useMemo<Record<string, string>>(() => {
    return auth ? buildAuthHeaders(auth) : EMPTY_HEADERS;
  }, [auth]);
  const flyTokenStatus = useFlyTokenStatus(headers);
  const flyTokenConfigured = flyTokenStatus.configured;
  const copy = FLY_VIEW_COPY[view];

  if (view === "machines") {
    return (
      <div className="h-full flex flex-col">
        <VaultLockedBanner feature="Fly runners and previews stay off until the vault can be read." />
        <div className="flex-1 min-h-0">
          <FlyMachinesTable
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
            selectedApp={selectedApp}
            selectedMachineId={selectedMachineId}
          />
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title={copy.title}
      icon={Rocket}
      iconClassName="text-sky-400"
      subtitle={copy.subtitle}
    >
      <div className="space-y-4">
        <VaultLockedBanner feature="Fly runners and previews stay off until the vault can be read." />

        {view === "config" && (
          <RunnerConfigView headers={headers} flyTokenStatus={flyTokenStatus} />
        )}

        {view === "previews" && (
          <FlyPreviewsView
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        )}

        {view === "history" && (
          <FlyActivityTab
            headers={headers}
            flyTokenConfigured={flyTokenConfigured}
          />
        )}
      </div>
    </PageShell>
  );
}
