"use client";

import { useEffect, useState } from "react";

export function useLocalMachineAvailability(
  requestHeaders: Readonly<Record<string, string>>,
): boolean {
  const [available, setAvailable] = useState(false);
  const headersKey = JSON.stringify(requestHeaders);

  useEffect(() => {
    if (!requestHeaders["x-kody-token"]) {
      setAvailable(false);
      return;
    }
    const controller = new AbortController();
    void fetch("/api/kody/chat/machines", {
      cache: "no-store",
      headers: requestHeaders,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return { local: false };
        return (await response.json()) as { local?: unknown };
      })
      .then((result) => setAvailable(result.local === true))
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.name === "AbortError")) {
          setAvailable(false);
        }
      });
    return () => controller.abort();
    // Equivalent header objects must not restart capability discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headersKey]);

  return available;
}
