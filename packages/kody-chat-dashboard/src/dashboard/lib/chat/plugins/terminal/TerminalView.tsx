"use client";

import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";
import { toast } from "sonner";

import { RepoScopedLink } from "../../../components/RepoScopedLink";
import { mountChatTerminal, resetTerminalUiForRestart } from "./xterm-setup";
import type { VisibleTerminalStartupIssue } from "./terminal-startup-issue";
import type { TerminalTransportRecovery } from "./terminal-session-client";

export interface TerminalViewHandle {
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  focus(): void;
  fit(): void;
  resetModes(): void;
  getSize(): { cols: number; rows: number };
}

interface TerminalViewProps {
  active: boolean;
  topToolbar?: ReactNode;
  startupIssue: VisibleTerminalStartupIssue | null;
  recovery: TerminalTransportRecovery | null;
  startupActionBusy: boolean;
  onStartupAction: () => void;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  onReady: () => void;
}

export const TerminalView = forwardRef<TerminalViewHandle, TerminalViewProps>(
  function TerminalView(
    {
      active,
      topToolbar,
      startupIssue,
      recovery,
      startupActionBusy,
      onStartupAction,
      onData,
      onResize,
      onReady,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const terminalRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<XTermFitAddon | null>(null);
    const activeRef = useRef(active);
    const selectionTimerRef = useRef<number | null>(null);
    const [selectedText, setSelectedText] = useState("");

    useEffect(() => {
      activeRef.current = active;
    }, [active]);

    const rememberSelection = useCallback((selection: string) => {
      if (selectionTimerRef.current !== null) {
        window.clearTimeout(selectionTimerRef.current);
      }
      if (selection.trim()) {
        setSelectedText(selection);
        return;
      }
      selectionTimerRef.current = window.setTimeout(() => {
        setSelectedText("");
        selectionTimerRef.current = null;
      }, 6000);
    }, []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      let disposed = false;
      let observer: ResizeObserver | null = null;
      let disposables: Array<{ dispose: () => void }> = [];
      void mountChatTerminal(
        host,
        {
          onData,
          onSelectionChange: rememberSelection,
          onResize,
          isActive: () => activeRef.current,
        },
        () => disposed,
      ).then((mounted) => {
        if (!mounted) return;
        observer = mounted.observer;
        disposables = mounted.disposables;
        terminalRef.current = mounted.terminal;
        fitAddonRef.current = mounted.fitAddon;
        onReady();
      });
      return () => {
        disposed = true;
        observer?.disconnect();
        for (const disposable of disposables) disposable.dispose();
        terminalRef.current?.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }, [onData, onReady, onResize, rememberSelection]);

    useEffect(
      () => () => {
        if (selectionTimerRef.current !== null) {
          window.clearTimeout(selectionTimerRef.current);
        }
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        write: (data) => terminalRef.current?.write(data),
        writeln: (data) => terminalRef.current?.writeln(data),
        clear: () => {
          setSelectedText("");
          terminalRef.current?.clear();
        },
        focus: () => terminalRef.current?.focus(),
        fit: () => fitAddonRef.current?.fit(),
        resetModes: () => {
          if (terminalRef.current)
            resetTerminalUiForRestart(terminalRef.current);
        },
        getSize: () => ({
          cols: terminalRef.current?.cols ?? 120,
          rows: terminalRef.current?.rows ?? 36,
        }),
      }),
      [],
    );

    const copySelection = useCallback(async () => {
      if (!selectedText.trim()) return;
      try {
        await navigator.clipboard.writeText(selectedText);
        toast.success("Terminal selection copied");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Copy failed");
      }
    }, [selectedText]);

    return (
      <div className="isolate flex h-full min-h-0 flex-col overflow-hidden bg-[#050608]">
        {topToolbar && (
          <div className="flex min-h-12 items-center border-b border-border bg-background px-3 py-2">
            {topToolbar}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden p-2">
          {recovery && !startupIssue && (
            <section
              role="status"
              data-testid="terminal-recovery-status"
              className="absolute left-1/2 top-4 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md border border-border/70 bg-background/95 px-3 py-2 text-center text-body-xs text-muted-foreground shadow-sm"
            >
              <span>{recovery.message}</span>
              {recovery.details && (
                <details className="mt-1 text-left">
                  <summary className="cursor-pointer">Connection details</summary>
                  <p className="mt-1 break-words font-mono text-[11px]">
                    {recovery.details}
                  </p>
                </details>
              )}
            </section>
          )}
          {startupIssue && (
            <section
              role="alert"
              data-testid="terminal-startup-issue"
              className="absolute inset-0 z-30 flex items-center justify-center bg-[#050608]/95 p-6"
            >
              <div className="max-w-md text-center">
                <h3 className="text-sm font-medium text-foreground">
                  {startupIssue.title}
                </h3>
                <p className="mt-2 text-body-xs text-muted-foreground">
                  {startupIssue.message}
                </p>
                {startupIssue.action === "settings" ? (
                  <RepoScopedLink
                    href="/secrets"
                    className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-body-xs font-medium text-primary-foreground"
                  >
                    {startupIssue.actionLabel}
                  </RepoScopedLink>
                ) : (
                  <button
                    type="button"
                    disabled={startupActionBusy}
                    onClick={onStartupAction}
                    className="mt-4 inline-flex h-8 items-center rounded-md bg-primary px-3 text-body-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {startupActionBusy ? "Working…" : startupIssue.actionLabel}
                  </button>
                )}
              </div>
            </section>
          )}
          {selectedText.trim() && (
            <button
              type="button"
              className="absolute right-4 top-4 z-20 rounded-md border border-border bg-background px-2 py-1 text-body-xs text-foreground shadow-sm transition-colors hover:bg-muted"
              onClick={() => void copySelection()}
            >
              Copy selection
            </button>
          )}
          <div
            ref={hostRef}
            className="terminal-scroll-host h-full min-h-0 overflow-auto"
          />
        </div>
      </div>
    );
  },
);
