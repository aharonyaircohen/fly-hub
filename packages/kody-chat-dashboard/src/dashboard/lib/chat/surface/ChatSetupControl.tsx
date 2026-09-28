"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { AgentId } from "../../agents";
import type { MachineAccess } from "../../chat-types";
import { RepoScopedLink } from "../../components/RepoScopedLink";
import type { ModelReasoning } from "../core/reasoning-adapter";
import type { ChatDropdownEntry } from "../platform/agent-entries";

export type ChatSetupSection = "agent" | "model" | "effort" | "machine";

const MACHINE_LABELS: Record<MachineAccess, string> = {
  none: "No access",
  local: "Local",
  brain: "Brain",
};
const MACHINE_SUMMARY_LABELS: Record<MachineAccess, string> = {
  none: "No machine access",
  local: "Local",
  brain: "Brain",
};

interface ChatSetupControlProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  requestedSection?: ChatSetupSection | null;
  onRequestedSectionHandled?: () => void;
  currentModelName: string;
  modelEntries: readonly ChatDropdownEntry[];
  selectedAgentId: AgentId;
  selectedModelId: string | null;
  onSelectModel: (entry: ChatDropdownEntry) => void;
  reasoning: ModelReasoning | null;
  effort: string | null;
  onSelectEffort: (effort: string) => void;
  showAgencyAgent: boolean;
  agencyAgents: ReadonlyArray<{ slug: string; title: string }>;
  selectedAgencyAgentSlug: string;
  onSelectAgencyAgent: (slug: string) => void;
  machineAccess: MachineAccess;
  machineOptions: readonly MachineAccess[];
  onSelectMachine: (machineAccess: MachineAccess) => void;
}

function SetupRow({
  label,
  value,
  expanded,
  onClick,
  ariaLabel,
}: {
  label: string;
  value: string;
  expanded: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded px-2.5 py-2 text-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={ariaLabel}
      aria-expanded={expanded}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-auto max-w-[180px] truncate text-muted-foreground">
        {value}
      </span>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function Choice({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-start text-sm hover:bg-accent ${selected ? "bg-accent/50" : ""}`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}

export function ChatSetupControl(props: ChatSetupControlProps) {
  const { onRequestedSectionHandled, open, requestedSection } = props;
  const [section, setSection] = useState<ChatSetupSection | null>(null);
  useEffect(() => {
    if (!open) setSection(null);
  }, [open]);
  useEffect(() => {
    if (!open || !requestedSection) return;
    setSection(requestedSection);
    onRequestedSectionHandled?.();
  }, [onRequestedSectionHandled, open, requestedSection]);

  const agencyAgents = [
    { slug: "kody", title: "Kody" },
    ...props.agencyAgents.filter((agent) => agent.slug !== "kody"),
  ];
  const selectedAgencyAgent =
    agencyAgents.find(
      (agent) => agent.slug === props.selectedAgencyAgentSlug,
    ) ?? agencyAgents[0];
  const effortLabel =
    props.reasoning?.efforts.find((item) => item.value === props.effort)
      ?.label ?? "Default";
  const primarySummary = [
    selectedAgencyAgent.title,
    props.currentModelName,
  ].join(" · ");
  const secondarySummary = [
    `${effortLabel} effort`,
    MACHINE_SUMMARY_LABELS[props.machineAccess],
  ].join(" · ");
  const summary = `${primarySummary} · ${secondarySummary}`;
  const toggleSection = (next: ChatSetupSection) =>
    setSection((current) => (current === next ? null : next));
  const modelGroups = [
    {
      label: "",
      entries: props.modelEntries.filter((entry) => !entry.modelGroup),
    },
    {
      label: "Built-in models",
      entries: props.modelEntries.filter(
        (entry) => entry.modelGroup === "built-in",
      ),
    },
    {
      label: "Your models",
      entries: props.modelEntries.filter(
        (entry) => entry.modelGroup === "user",
      ),
    },
  ].filter((group) => group.entries.length > 0);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => props.setOpen(!props.open)}
        className="flex min-w-0 max-w-[300px] items-center gap-1.5 rounded-md border border-border/60 bg-muted/60 px-2.5 py-1.5 text-start hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
        aria-haspopup="menu"
        aria-expanded={props.open}
        aria-label="Chat setup"
        title={summary}
      >
        <span className="flex min-w-0 flex-1 flex-col items-start leading-tight">
          <span
            data-testid="chat-setup-primary"
            className="w-full truncate text-sm font-medium"
          >
            {primarySummary}
          </span>
          <span
            data-testid="chat-setup-secondary"
            className="w-full truncate text-[11px] font-normal text-muted-foreground"
          >
            {secondarySummary}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>

      {props.open ? (
        <div
          data-testid="chat-setup-menu"
          className="absolute start-0 top-full z-50 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 shadow-lg"
          role="menu"
        >
          {props.showAgencyAgent && selectedAgencyAgent ? (
            <>
              <SetupRow
                label="Agent"
                value={selectedAgencyAgent.title}
                expanded={section === "agent"}
                onClick={() => toggleSection("agent")}
                ariaLabel="Agency agent"
              />
              {section === "agent" ? (
                <div role="listbox" className="mb-1 border-b pb-1">
                  {agencyAgents.map((agent) => (
                    <Choice
                      key={agent.slug}
                      selected={agent.slug === props.selectedAgencyAgentSlug}
                      onClick={() => props.onSelectAgencyAgent(agent.slug)}
                    >
                      <span className="block font-medium">{agent.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {agent.slug}
                      </span>
                    </Choice>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          <SetupRow
            label="Model"
            value={props.currentModelName}
            expanded={section === "model"}
            onClick={() => toggleSection("model")}
            ariaLabel="Model"
          />
          {section === "model" ? (
            <div
              role="listbox"
              aria-label="Models"
              className="mb-1 max-h-[50dvh] overflow-y-auto border-b pb-1"
            >
              {modelGroups.map((group) => (
                <div
                  key={group.label || "connections"}
                  role="group"
                  aria-label={group.label || "Connections"}
                  className={group.label ? "mt-2 border-t pt-2" : undefined}
                >
                  {group.label ? (
                    <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </div>
                  ) : null}
                  {group.entries.map((entry) => (
                    <Choice
                      key={entry.key}
                      selected={
                        entry.agentId === props.selectedAgentId &&
                        (entry.modelId ?? null) === props.selectedModelId
                      }
                      onClick={() => props.onSelectModel(entry)}
                    >
                      <span className="block font-medium">{entry.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {entry.description}
                      </span>
                    </Choice>
                  ))}
                </div>
              ))}
              <RepoScopedLink
                href="/models"
                className="flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-accent"
                onClick={() => props.setOpen(false)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add chat model
              </RepoScopedLink>
            </div>
          ) : null}

          <SetupRow
            label="Effort"
            value={effortLabel}
            expanded={section === "effort"}
            onClick={() => props.reasoning && toggleSection("effort")}
            ariaLabel="Effort"
          />
          {section === "effort" && props.reasoning ? (
            <div role="listbox" className="mb-1 border-b pb-1">
              {props.reasoning.efforts.map((effort) => (
                <Choice
                  key={effort.value}
                  selected={effort.value === props.effort}
                  onClick={() => props.onSelectEffort(effort.value)}
                >
                  {effort.label}
                </Choice>
              ))}
            </div>
          ) : null}

          {props.machineOptions.length > 1 ? (
            <>
              <SetupRow
                label="Machine"
                value={MACHINE_LABELS[props.machineAccess]}
                expanded={section === "machine"}
                onClick={() => toggleSection("machine")}
                ariaLabel="Machine"
              />
              {section === "machine" ? (
                <div role="listbox">
                  {props.machineOptions.map((machineAccess) => (
                    <Choice
                      key={machineAccess}
                      selected={machineAccess === props.machineAccess}
                      onClick={() => props.onSelectMachine(machineAccess)}
                    >
                      {MACHINE_LABELS[machineAccess]}
                    </Choice>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
