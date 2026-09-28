"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { CapabilitiesWorkspace } from "./CapabilitiesManager";

const FILES_ROUTE_MARKER = "/capabilities/files/";

function capabilityPath(pathname: string): string {
  const markerIndex = pathname.lastIndexOf(FILES_ROUTE_MARKER);
  if (markerIndex < 0) return "";
  return pathname
    .slice(markerIndex + FILES_ROUTE_MARKER.length)
    .split("/")
    .map(decodeURIComponent)
    .join("/");
}

export function CapabilitiesWorkspaceShell() {
  const pathname = usePathname();
  const initialPath = useMemo(() => capabilityPath(pathname), [pathname]);

  return <CapabilitiesWorkspace initialPath={initialPath} />;
}
