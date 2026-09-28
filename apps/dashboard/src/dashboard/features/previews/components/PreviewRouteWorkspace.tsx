"use client";

import { useParams } from "next/navigation";

import { PreviewWorkspace } from "./PreviewWorkspace";

export function PreviewRouteWorkspace() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params?.id;
  const selectedId = Array.isArray(rawId) ? (rawId[0] ?? null) : (rawId ?? null);

  return <PreviewWorkspace selectedId={selectedId} />;
}
