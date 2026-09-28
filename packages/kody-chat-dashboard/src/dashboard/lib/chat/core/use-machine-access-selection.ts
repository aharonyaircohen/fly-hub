"use client";

import { useCallback, useEffect, useState } from "react";
import type { MachineAccess } from "../../chat-types";
import type { UseConversationSessionsResult } from "./conversation/use-conversation-sessions";

export function useMachineAccessSelection(
  sessionHook: UseConversationSessionsResult,
) {
  const [machineAccess, setMachineAccessState] =
    useState<MachineAccess>("none");
  const activeSessionId = sessionHook.activeSession?.id;
  const storedMachineAccess = sessionHook.activeSession?.machineAccess;
  const persistMachineAccess = sessionHook.setSessionMachineAccess;

  useEffect(() => {
    setMachineAccessState(storedMachineAccess ?? "none");
  }, [activeSessionId, storedMachineAccess]);

  const setMachineAccess = useCallback(
    (next: MachineAccess) => {
      setMachineAccessState(next);
      if (activeSessionId) {
        persistMachineAccess(activeSessionId, next);
      }
    },
    [activeSessionId, persistMachineAccess],
  );

  return { machineAccess, setMachineAccess };
}
