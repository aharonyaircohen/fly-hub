/**
 * @fileType component
 * @domain events
 * @pattern system-event-page-tracker
 * @ai-summary Invisible client component that emits `page.viewed` on every
 *   route change (App Router pathname) and starts the browser session on
 *   mount. Mount once per layout. Canonical copy — hosts re-export this.
 */
"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { startBrowserSession, trackSystemEvent } from "./client";

export function PageViewTracker(): null {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    startBrowserSession();
  }, []);

  useEffect(() => {
    if (!pathname || pathname === previousPath.current) return;
    trackSystemEvent("page.viewed", {
      path: pathname,
      ...(previousPath.current ? { referrerPath: previousPath.current } : {}),
    });
    previousPath.current = pathname;
  }, [pathname]);

  return null;
}
