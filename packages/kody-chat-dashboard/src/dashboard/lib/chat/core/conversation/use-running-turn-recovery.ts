import { useCallback, useEffect } from "react";

const RUNNING_TURN_REFRESH_MS = 1_500;

export function useRunningTurnRecovery(input: {
  activeSessionId: string;
  hydrated: boolean;
  persistenceEnabled: boolean;
  recoveringSessionIds: ReadonlySet<string>;
  setRecoveringSessionIds: (
    update: (previous: Set<string>) => Set<string>,
  ) => void;
  loadDetail: (conversationId: string) => Promise<boolean>;
  onError: (error: unknown) => void;
}): (sessionId: string) => void {
  const {
    activeSessionId,
    hydrated,
    persistenceEnabled,
    recoveringSessionIds,
    setRecoveringSessionIds,
    loadDetail,
    onError,
  } = input;
  const recoverRunningTurn = useCallback(
    (sessionId: string) => {
      setRecoveringSessionIds((previous) => {
        if (previous.has(sessionId)) return previous;
        const next = new Set(previous);
        next.add(sessionId);
        return next;
      });
    },
    [setRecoveringSessionIds],
  );
  useEffect(() => {
    if (
      !hydrated ||
      !persistenceEnabled ||
      !activeSessionId ||
      !recoveringSessionIds.has(activeSessionId)
    ) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const stillRunning = await loadDetail(activeSessionId);
        if (!cancelled && stillRunning) {
          timer = setTimeout(refresh, RUNNING_TURN_REFRESH_MS);
        }
      } catch (error) {
        if (!cancelled) {
          onError(error);
          timer = setTimeout(refresh, RUNNING_TURN_REFRESH_MS);
        }
      }
    };
    timer = setTimeout(refresh, RUNNING_TURN_REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    activeSessionId,
    hydrated,
    loadDetail,
    onError,
    persistenceEnabled,
    recoveringSessionIds,
  ]);
  return recoverRunningTurn;
}
