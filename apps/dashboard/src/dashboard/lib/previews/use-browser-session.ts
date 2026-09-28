"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  actInBrowserSession,
  fetchBrowserSession,
  resumeBrowserSession,
  startBrowserSession,
  stageBrowserUpload,
  type BrowserSessionAction,
  type BrowserUploadFile,
  type BrowserSessionStatus,
  type RemoteBrowserActionResult,
} from "./browser-session-client";

type ActiveRemoteSession = Extract<
  BrowserSessionStatus,
  { mode: "remote"; sessionId: string }
>;

export type BrowserSessionMode =
  | { kind: "disabled" }
  | { kind: "checking" }
  | { kind: "iframe"; reason: string }
  | { kind: "remote"; session: ActiveRemoteSession }
  | { kind: "error"; error: string };

export function useBrowserSession(input: {
  enabled: boolean;
  actorLogin?: string;
  initialUrl: string | null;
  resolveUploadFiles?: (paths: string[]) => Promise<BrowserUploadFile[]>;
}) {
  const [mode, setMode] = useState<BrowserSessionMode>(
    input.enabled ? { kind: "checking" } : { kind: "disabled" },
  );
  const generationRef = useRef(0);
  const connectingRef = useRef(false);
  const modeRef = useRef(mode);
  const sessionRef = useRef<ActiveRemoteSession | null>(null);
  const initialUrlRef = useRef(input.initialUrl);
  const resumeInFlightRef = useRef(false);
  const autoRecoveryBlockedRef = useRef(false);
  const stableConnectionTimerRef = useRef<number | undefined>(undefined);
  const resolveUploadFiles = input.resolveUploadFiles;
  modeRef.current = mode;
  initialUrlRef.current = input.initialUrl;

  const connect = useCallback(
    async (forceStart = false) => {
      const initialUrl = initialUrlRef.current;
      if (!input.enabled || !initialUrl) {
        sessionRef.current = null;
        setMode({ kind: "disabled" });
        return;
      }
      if (!input.actorLogin) {
        setMode({ kind: "checking" });
        return;
      }
      if (connectingRef.current) return;
      connectingRef.current = true;
      const generation = ++generationRef.current;
      setMode({ kind: "checking" });
      try {
        const status = await fetchBrowserSession(input.actorLogin);
        if (generation !== generationRef.current) return;
        if (status.mode === "iframe") {
          sessionRef.current = null;
          setMode({ kind: "iframe", reason: status.reason });
          return;
        }

        let session: BrowserSessionStatus = status;
        if (
          forceStart ||
          status.state === "idle" ||
          status.state === "failed"
        ) {
          session = { mode: "remote", state: "idle" };
          for (let attempt = 0; attempt < 75; attempt += 1) {
            try {
              session = await startBrowserSession(input.actorLogin, initialUrl);
              break;
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error.message !== "browser_start_in_progress" ||
                attempt === 74
              ) {
                throw error;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            }
          }
        }
        if (generation !== generationRef.current) return;
        if (session.mode === "iframe") {
          sessionRef.current = null;
          setMode({ kind: "iframe", reason: session.reason });
          return;
        }
        if (session.state === "idle" || session.state === "failed") {
          throw new Error("browser_session_failed");
        }
        if (
          !forceStart &&
          status.state !== "idle" &&
          status.state !== "failed" &&
          status.currentUrl !== initialUrl
        ) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              const desiredUrl = initialUrlRef.current;
              if (!desiredUrl) return;
              const navigation = await actInBrowserSession(
                input.actorLogin,
                status.sessionId,
                { type: "navigate", url: desiredUrl },
              );
              if (generation !== generationRef.current) return;
              if (initialUrlRef.current !== desiredUrl) continue;
              const alignedSession: ActiveRemoteSession = {
                ...status,
                currentUrl: navigation.url ?? desiredUrl,
              };
              sessionRef.current = alignedSession;
              setMode({
                kind: "remote",
                session: alignedSession,
              });
              return;
            } catch {
              if (attempt < 2) {
                await new Promise((resolve) =>
                  window.setTimeout(resolve, 1_500),
                );
              }
            }
          }
        }
        sessionRef.current = session;
        setMode({ kind: "remote", session });
      } catch (error) {
        if (generation !== generationRef.current) return;
        setMode({
          kind: "error",
          error:
            error instanceof Error ? error.message : "browser_session_failed",
        });
      } finally {
        connectingRef.current = false;
      }
    },
    [input.actorLogin, input.enabled],
  );

  const resume = useCallback(async () => {
    if (resumeInFlightRef.current || !input.enabled || !input.actorLogin) {
      return;
    }
    const currentSession = sessionRef.current;
    if (!currentSession) {
      await connect(true);
      return;
    }
    resumeInFlightRef.current = true;
    const generation = ++generationRef.current;
    try {
      const session = await resumeBrowserSession(
        input.actorLogin,
        currentSession.sessionId,
      );
      if (generation !== generationRef.current) return;
      if (session.mode === "iframe") {
        sessionRef.current = null;
        setMode({ kind: "iframe", reason: session.reason });
        return;
      }
      if (session.state === "idle" || session.state === "failed") {
        throw new Error("browser_session_failed");
      }
      sessionRef.current = session;
      setMode({ kind: "remote", session });
    } catch (error) {
      if (generation !== generationRef.current) return;
      setMode({
        kind: "error",
        error:
          error instanceof Error ? error.message : "browser_session_failed",
      });
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [connect, input.actorLogin, input.enabled]);

  useEffect(() => {
    void connect(false);
    return () => {
      generationRef.current += 1;
    };
  }, [connect]);

  useEffect(() => {
    if (
      modeRef.current.kind === "remote" ||
      modeRef.current.kind === "checking"
    ) {
      return;
    }
    void connect(false);
  }, [connect, input.initialUrl]);

  useEffect(() => {
    if (mode.kind !== "remote") return;
    const refreshBeforeExpiry = (): void => {
      if (document.visibilityState === "visible") void resume();
    };
    const refreshAtMs = mode.session.ticketExpiresAt * 1_000 - 30_000;
    const refreshTimer = window.setTimeout(
      refreshBeforeExpiry,
      Math.max(0, refreshAtMs - Date.now()),
    );
    const handleVisibility = (): void => {
      if (
        document.visibilityState === "visible" &&
        mode.session.ticketExpiresAt * 1_000 <= Date.now() + 30_000
      ) {
        void resume();
      }
    };
    const handleOnline = (): void => void resume();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnline);
    };
  }, [mode, resume]);

  const act = useCallback(
    async (
      action: BrowserSessionAction,
    ): Promise<RemoteBrowserActionResult> => {
      const currentMode = modeRef.current;
      if (currentMode.kind !== "remote" || !input.actorLogin) {
        return { ok: false, error: "browser_session_unavailable" };
      }
      if (action.type === "upload") {
        if (!resolveUploadFiles) {
          return { ok: false, error: "browser_upload_resolver_unavailable" };
        }
        const refreshed = await fetchBrowserSession(input.actorLogin);
        if (refreshed.mode !== "remote" || refreshed.state === "idle") {
          return { ok: false, error: "browser_session_unavailable" };
        }
        const files = await resolveUploadFiles(action.paths);
        const uploadId = crypto.randomUUID();
        await stageBrowserUpload({
          uploadUrl: refreshed.uploadUrl,
          uploadId,
          files,
        });
        return actInBrowserSession(input.actorLogin, refreshed.sessionId, {
          type: "upload",
          selector: action.selector,
          uploadId,
          allowedOrigins: action.allowedOrigins,
          capabilitySlug: action.capabilitySlug,
        });
      }
      const result = await actInBrowserSession(
        input.actorLogin,
        currentMode.session.sessionId,
        action,
      );
      if (result.url) {
        sessionRef.current = sessionRef.current
          ? { ...sessionRef.current, currentUrl: result.url }
          : null;
        setMode((current) =>
          current.kind === "remote"
            ? {
                kind: "remote",
                session: { ...current.session, currentUrl: result.url! },
              }
            : current,
        );
      }
      return result;
    },
    [input.actorLogin, resolveUploadFiles],
  );

  const recover = useCallback(() => {
    if (autoRecoveryBlockedRef.current) return;
    autoRecoveryBlockedRef.current = true;
    void resume();
  }, [resume]);

  const reconnect = useCallback(() => {
    window.clearTimeout(stableConnectionTimerRef.current);
    autoRecoveryBlockedRef.current = true;
    void resume();
  }, [resume]);

  const markConnected = useCallback(() => {
    window.clearTimeout(stableConnectionTimerRef.current);
    stableConnectionTimerRef.current = window.setTimeout(() => {
      autoRecoveryBlockedRef.current = false;
    }, 10_000);
  }, []);

  useEffect(
    () => () => window.clearTimeout(stableConnectionTimerRef.current),
    [],
  );

  const openDirectLogin = useCallback(async (): Promise<boolean> => {
    if (!input.actorLogin || modeRef.current.kind !== "remote") return false;
    const directWindow = window.open("about:blank", "_blank");
    if (!directWindow) return false;
    directWindow.opener = null;
    directWindow.document.title = "Opening browser…";
    try {
      const refreshed = await fetchBrowserSession(input.actorLogin);
      if (
        refreshed.mode !== "remote" ||
        refreshed.state === "idle" ||
        !refreshed.directUrl
      ) {
        throw new Error("browser_session_unavailable");
      }
      directWindow.location.replace(refreshed.directUrl);
      return true;
    } catch {
      directWindow.close();
      return false;
    }
  }, [input.actorLogin]);

  return { mode, act, recover, reconnect, markConnected, openDirectLogin };
}
