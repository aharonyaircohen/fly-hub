"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  BrowserSessionAction,
  RemoteBrowserActionResult,
} from "@dashboard/lib/previews/browser-session-client";
import type {
  ElementPicker,
  ScreenshotResult,
  UseElementPickerOptions,
} from "./useElementPicker";
import type {
  LogEntry,
  NetworkEntry,
  PageInfo,
  PerfReport,
  PreviewAction,
  PreviewEditCommand,
  RecordedStep,
} from "./protocol";

type RemoteAct = (
  action: BrowserSessionAction,
) => Promise<RemoteBrowserActionResult>;

interface RemoteSnapshotElement {
  ref?: string;
  selector?: string;
  tag?: string;
  role?: string | null;
  name?: string;
  disabled?: boolean;
  box?: { width?: number; height?: number };
}

function interactivePriority(element: RemoteSnapshotElement): number {
  if (element.role === "textbox" || element.tag === "textarea") return 0;
  if (element.role === "button" || element.tag === "button") return 1;
  if (element.role === "combobox" || element.tag === "input") return 2;
  if (element.role === "link" || element.tag === "a") return 4;
  return 3;
}

export function formatRemoteSnapshotOutline(snapshot: {
  text?: string;
  elements?: unknown[];
}): string {
  const controls = (snapshot.elements ?? [])
    .map((value, index) => ({
      ...(value && typeof value === "object"
        ? (value as RemoteSnapshotElement)
        : {}),
      index,
    }))
    .filter(
      (element) =>
        Boolean(element.selector && element.name?.trim()) &&
        element.disabled !== true &&
        (element.box?.width === undefined || element.box.width > 0) &&
        (element.box?.height === undefined || element.box.height > 0),
    )
    .sort(
      (left, right) =>
        interactivePriority(left) - interactivePriority(right) ||
        left.index - right.index,
    )
    .slice(0, 30)
    .map((element) => {
      const identity = element.role ?? element.tag ?? "control";
      return `- ${identity} ${JSON.stringify(element.name!.trim().slice(0, 160))} — selector: ${element.selector!.slice(0, 500)}`;
    });
  const visibleText = snapshot.text?.trim().slice(0, 1_500);
  return [
    ...(controls.length ? ["Interactive controls:", ...controls] : []),
    ...(visibleText ? [controls.length ? "" : null, "Visible text:", visibleText] : []),
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
    .slice(0, 4_000);
}

function pageInfo(result: RemoteBrowserActionResult): PageInfo | null {
  if (!result.ok) return null;
  const data = result.data as
    { snapshot?: { text?: string; elements?: unknown[] } } | undefined;
  const outline = formatRemoteSnapshotOutline(data?.snapshot ?? {});
  return {
    url: result.url ?? "",
    title: result.title ?? "",
    selection: "",
    dom: outline,
  };
}

export async function actInRemotePreview(
  remoteAct: RemoteAct,
  action: PreviewAction,
): Promise<{ ok: boolean; error?: string; info?: PageInfo }> {
  const scope = {
    allowedOrigins: action.allowedOrigins,
    capabilitySlug: action.capabilitySlug,
  };
  let mapped: BrowserSessionAction;
  switch (action.op) {
    case "click":
      mapped = { type: "click", selector: action.selector, ...scope };
      break;
    case "fill":
      mapped = {
        type: "fill",
        selector: action.selector,
        value: action.value,
        ...scope,
      };
      break;
    case "navigate":
      mapped = { type: "navigate", url: action.url, ...scope };
      break;
    case "upload":
      mapped = {
        type: "upload",
        selector: action.selector,
        paths: action.paths,
        allowedOrigins: action.allowedOrigins,
        capabilitySlug: action.capabilitySlug,
      };
      break;
    case "scroll":
      mapped = {
        type: "scroll",
        selector: action.selector,
        deltaY: action.dy ?? 600,
        ...scope,
      };
      break;
    case "wait":
      mapped = { type: "wait", ms: action.ms, ...scope };
      break;
  }
  const result = await remoteAct(mapped);
  return {
    ok: result.ok,
    error: result.error,
    info: pageInfo(result) ?? undefined,
  };
}

export function useRemoteElementPicker(
  enabled: boolean,
  remoteAct: RemoteAct,
  opts: UseElementPickerOptions,
): ElementPicker {
  const [armed, setArmed] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recStepCount, setRecStepCount] = useState(0);
  const pickGenerationRef = useRef(0);

  const arm = useCallback(() => {
    const generation = ++pickGenerationRef.current;
    setArmed(true);
    void (async () => {
      const armedResult = await remoteAct({ type: "pick" });
      if (!armedResult.ok || generation !== pickGenerationRef.current) {
        if (generation === pickGenerationRef.current) setArmed(false);
        return;
      }
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        if (generation !== pickGenerationRef.current) return;
        const result = await remoteAct({ type: "pickResult" });
        if (!result.ok) break;
        const element = (
          result.data as
            { element?: Parameters<typeof opts.onSelect>[0] } | undefined
        )?.element;
        if (element) {
          pickGenerationRef.current += 1;
          setArmed(false);
          opts.onSelect(element);
          return;
        }
      }
      if (generation === pickGenerationRef.current) {
        pickGenerationRef.current += 1;
        setArmed(false);
        void remoteAct({ type: "cancelPick" });
      }
    })();
  }, [opts, remoteAct]);
  const disarm = useCallback(() => {
    pickGenerationRef.current += 1;
    setArmed(false);
    void remoteAct({ type: "cancelPick" });
  }, [remoteAct]);
  useEffect(
    () => () => {
      pickGenerationRef.current += 1;
    },
    [],
  );
  const collectSnapshot = useCallback(
    () => remoteAct({ type: "snapshot" }),
    [remoteAct],
  );

  return {
    available: enabled,
    armed,
    arm,
    disarm,
    toggle: armed ? disarm : arm,
    logCount: 0,
    networkCount: 0,
    collectLogs: async (): Promise<LogEntry[]> => {
      const result = await collectSnapshot();
      return (
        (result.data as { console?: LogEntry[] } | undefined)?.console ?? []
      );
    },
    collectNetwork: async (): Promise<NetworkEntry[]> => {
      const result = await collectSnapshot();
      return (
        (result.data as { failedRequests?: NetworkEntry[] } | undefined)
          ?.failedRequests ?? []
      );
    },
    captureScreenshot: async (): Promise<ScreenshotResult> => {
      const result = await remoteAct({ type: "screenshot" });
      const data = typeof result.data === "string" ? result.data : undefined;
      return data
        ? { dataUrl: `data:image/jpeg;base64,${data}`, mimeType: "image/jpeg" }
        : { error: result.error ?? "capture failed" };
    },
    collectPerf: async (): Promise<PerfReport | null> => {
      const result = await remoteAct({ type: "perf" });
      return result.ok ? (result.data as PerfReport) : null;
    },
    collectPage: async () => pageInfo(await collectSnapshot()),
    act: (action: PreviewAction) => actInRemotePreview(remoteAct, action),
    editPreview: async (command: PreviewEditCommand) => {
      const result = await remoteAct({ type: "edit", command });
      return { ok: result.ok, error: result.error };
    },
    undoPreviewEdit: async () => {
      const result = await remoteAct({ type: "undoEdit" });
      return { ok: result.ok, error: result.error };
    },
    resetPreviewEdits: async (selector?: string) => {
      const result = await remoteAct({ type: "resetEdits", selector });
      return { ok: result.ok, error: result.error };
    },
    recording,
    recStepCount,
    startRecording: () => {
      setRecStepCount(0);
      setRecording(true);
      void remoteAct({ type: "recordStart" });
    },
    stopRecording: async () => {
      const result = await remoteAct({ type: "recordStop" });
      setRecording(false);
      const recordingResult = result.data as
        { steps?: RecordedStep[]; url?: string } | undefined;
      setRecStepCount(recordingResult?.steps?.length ?? 0);
      return recordingResult?.steps
        ? {
            steps: recordingResult.steps,
            url: recordingResult.url ?? result.url ?? "",
          }
        : null;
    },
  };
}
