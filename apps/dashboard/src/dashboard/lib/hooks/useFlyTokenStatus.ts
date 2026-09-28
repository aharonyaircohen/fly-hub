"use client";

import { useEffect, useState } from "react";

export interface FlyTokenStatus {
  configured: boolean;
  source: "repo-vault" | null;
  loading: boolean;
}

const EMPTY_STATUS: FlyTokenStatus = {
  configured: false,
  source: null,
  loading: false,
};

interface FlyTokenStatusState {
  headers: Record<string, string> | null;
  status: FlyTokenStatus;
}

export function useFlyTokenStatus(
  headers: Record<string, string> | null,
): FlyTokenStatus {
  const [state, setState] = useState<FlyTokenStatusState>({
    headers: null,
    status: EMPTY_STATUS,
  });

  useEffect(() => {
    let cancelled = false;

    if (!headers || Object.keys(headers).length === 0) {
      setState({ headers, status: EMPTY_STATUS });
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const response = await fetch("/api/kody/fly/config-status", {
          headers,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("fly_config_status_failed");

        const body = (await response.json()) as Partial<FlyTokenStatus>;
        if (!cancelled) {
          setState({
            headers,
            status: {
              configured: body.configured === true,
              source: body.source === "repo-vault" ? "repo-vault" : null,
              loading: false,
            },
          });
        }
      } catch {
        if (!cancelled) setState({ headers, status: EMPTY_STATUS });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [headers]);

  if (!headers || Object.keys(headers).length === 0) return EMPTY_STATUS;
  if (state.headers !== headers) return { ...EMPTY_STATUS, loading: true };
  return state.status;
}
