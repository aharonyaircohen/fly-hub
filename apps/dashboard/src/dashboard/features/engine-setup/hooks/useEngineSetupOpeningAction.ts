"use client";

import { useMemo } from "react";

import { INITIALIZE_KODY_ENGINE_FLOW_ID } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";

import { useEngineSetupStatus } from "./useEngineSetupStatus";

export function useEngineSetupOpeningAction() {
  const query = useEngineSetupStatus();

  return useMemo(
    () =>
      query.data?.status === "setup_required"
        ? {
            id: "setup-kody",
            label: "Setup Kody",
            response: "setup-kody",
            variant: "secondary" as const,
            result: { guidedFlowId: INITIALIZE_KODY_ENGINE_FLOW_ID },
          }
        : null,
    [query.data?.status],
  );
}
