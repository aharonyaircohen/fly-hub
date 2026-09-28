/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Chat header chrome. Selection is presented through one setup
 * menu; conversation state and mutations remain owned by the host.
 */
"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  Globe,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  Plus,
  X,
} from "lucide-react";
import type { KodyTask } from "@kody-ade/base/types";
import type { AgentConfig, AgentId } from "../../agents";
import type { MachineAccess } from "../../chat-types";
import { writeReasoningEffort } from "../../reasoning-pref";
import {
  availableMachineAccessOptions,
  type MachineAvailability,
} from "../core/machine-access";
import type { ModelReasoning } from "../core/reasoning-adapter";
import type { ChatDropdownEntry } from "../platform/agent-entries";
import { ChatPluginSlot } from "./ChatPluginProvider";
import { ChatSetupControl, type ChatSetupSection } from "./ChatSetupControl";

interface HeaderControlsProps {
  currentEntry: ChatDropdownEntry | null;
  currentAgent: AgentConfig;
  lockedAgentId?: AgentId;
  hideAgentPicker?: boolean;
  showAgencyAgentPicker: boolean;
  compact?: boolean;
  agentMenuOpen: boolean;
  setAgentMenuOpen: Dispatch<SetStateAction<boolean>>;
  requestedSetupSection?: ChatSetupSection | null;
  onRequestedSetupSectionHandled?: () => void;
  messageCount: number;
  currentReasoning: ModelReasoning | null;
  effectiveReasoningEffort: string | null;
  setReasoningEffort: (value: string) => void;
  agentList: ChatDropdownEntry[];
  selectedAgentId: AgentId;
  selectedModelId: string | null;
  agencyAgents: ReadonlyArray<{ slug: string; title: string }>;
  selectedAgencyAgentSlug: string;
  onSelectAgencyAgent: (slug: string) => void;
  onSelectEntry: (entry: ChatDropdownEntry) => void;
  machineAccess: MachineAccess;
  machineAvailability: MachineAvailability;
  onSelectMachine: (machineAccess: MachineAccess) => void;
  remoteStatus?: { configured: boolean; online: boolean } | null;
  onNewConversation: () => void;
  hideNewConversation?: boolean;
  activeLoading: boolean;
  showSessionSidebar: boolean;
  sessionSidebarReady: boolean;
  onToggleSessionSidebar: () => void;
  onToggleFullscreen?: () => void;
  railFullscreen?: boolean;
  onCollapseRail?: () => void;
  onClose?: () => void;
  isTaskMode: boolean;
  selectedTask: KodyTask | null;
  isCapabilityMode: boolean;
  activeSessionTitle?: string;
}

export function HeaderControls(props: HeaderControlsProps) {
  const setupMenuRef = useRef<HTMLDivElement>(null);
  const { agentMenuOpen, setAgentMenuOpen } = props;

  useEffect(() => {
    if (!agentMenuOpen) return;
    const closeMenuOutsideTarget = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !setupMenuRef.current?.contains(event.target)
      ) {
        setAgentMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeMenuOutsideTarget);
    return () =>
      document.removeEventListener("pointerdown", closeMenuOutsideTarget);
  }, [agentMenuOpen, setAgentMenuOpen]);

  const headerClassName = props.compact
    ? "border-b bg-gradient-to-r from-muted/80 to-muted/40 px-3 py-1.5 sm:px-4"
    : "border-b bg-gradient-to-r from-muted/80 to-muted/40 px-3 py-2.5 sm:px-5 sm:py-4";
  const mainIconButtonClassName = props.compact
    ? "p-1.5 rounded-md border transition-all"
    : "p-2 rounded-md border transition-all";
  const quietIconButtonClassName = props.compact
    ? "p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all"
    : "p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-background border border-transparent hover:border-border transition-all";

  const chatSetupControl =
    !props.hideAgentPicker && !props.lockedAgentId ? (
      <div ref={setupMenuRef}>
        <ChatSetupControl
          open={props.agentMenuOpen}
          setOpen={props.setAgentMenuOpen}
          requestedSection={props.requestedSetupSection}
          onRequestedSectionHandled={props.onRequestedSetupSectionHandled}
          currentModelName={props.currentEntry?.name ?? props.currentAgent.name}
          modelEntries={props.agentList}
          selectedAgentId={props.selectedAgentId}
          selectedModelId={props.selectedModelId}
          onSelectModel={props.onSelectEntry}
          reasoning={props.currentReasoning}
          effort={props.effectiveReasoningEffort}
          onSelectEffort={(effort) => {
            props.setReasoningEffort(effort);
            if (props.selectedModelId) {
              writeReasoningEffort(props.selectedModelId, effort);
            }
          }}
          showAgencyAgent={props.showAgencyAgentPicker}
          agencyAgents={props.agencyAgents}
          selectedAgencyAgentSlug={props.selectedAgencyAgentSlug}
          onSelectAgencyAgent={props.onSelectAgencyAgent}
          machineAccess={props.machineAccess}
          machineOptions={availableMachineAccessOptions(
            props.machineAvailability,
          )}
          onSelectMachine={props.onSelectMachine}
        />
      </div>
    ) : null;

  const conversationActions = (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {!props.lockedAgentId &&
      !props.hideAgentPicker &&
      !props.hideNewConversation ? (
        <button
          type="button"
          onClick={props.onNewConversation}
          className={`${quietIconButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
          title="Start a new conversation"
          aria-label="New conversation"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        onClick={props.onToggleSessionSidebar}
        disabled={!props.sessionSidebarReady}
        aria-expanded={props.showSessionSidebar}
        className={`${mainIconButtonClassName} ${
          props.showSessionSidebar
            ? "border-primary bg-primary text-primary-foreground"
            : "border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground"
        } disabled:cursor-wait disabled:opacity-50`}
        title="Conversations"
        aria-label="Toggle conversations"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
      </button>
      {props.remoteStatus?.configured ? (
        <span
          className={`h-2 w-2 rounded-full ${props.remoteStatus.online ? "bg-green-500" : "bg-red-400"}`}
          title={
            props.remoteStatus.online
              ? "Remote dev: online"
              : "Remote dev: offline"
          }
          aria-label={
            props.remoteStatus.online
              ? "Remote dev online"
              : "Remote dev offline"
          }
        />
      ) : null}
      <ChatPluginSlot slot="header-actions" />
      {props.onToggleFullscreen ? (
        <button
          type="button"
          onClick={props.onToggleFullscreen}
          aria-label={
            props.railFullscreen
              ? "Restore chat width"
              : "Expand chat fullscreen"
          }
          title={props.railFullscreen ? "Restore" : "Fullscreen"}
          className={quietIconButtonClassName}
        >
          {props.railFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      ) : null}
      {props.onCollapseRail ? (
        <button
          type="button"
          onClick={props.onCollapseRail}
          aria-label="Collapse chat"
          title="Collapse"
          className={quietIconButtonClassName}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      ) : null}
      {props.onClose ? (
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close chat"
          title="Close"
          className={quietIconButtonClassName}
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  const messageCountBadge =
    props.messageCount > 0 ? (
      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-body-xs text-primary">
        {props.messageCount}
      </span>
    ) : null;

  return (
    <>
      <div className={headerClassName} data-testid="chat-header-controls">
        <div className="flex min-h-7 w-full items-center">
          {chatSetupControl}
          {conversationActions}
        </div>
      </div>
      <div
        data-testid="chat-context-bar"
        className="border-b bg-background/80 px-3 py-0.5 sm:px-5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            {props.isTaskMode && props.selectedTask ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground">
                  #{props.selectedTask.issueNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {props.selectedTask.title}
                </span>
                {messageCountBadge}
              </div>
            ) : props.isCapabilityMode ? (
              <div className="flex items-center gap-2 text-sm">
                <span
                  data-testid="chat-context-title"
                  className="min-w-0 flex-1 truncate text-muted-foreground"
                >
                  {props.activeSessionTitle ?? "New conversation"}
                </span>
                {messageCountBadge}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Globe className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {props.activeSessionTitle &&
                  props.activeSessionTitle !== "New conversation"
                    ? props.activeSessionTitle
                    : "Global chat — not tied to any task"}
                </span>
                {messageCountBadge}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
