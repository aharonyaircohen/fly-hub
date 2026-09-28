/**
 * @fileType page
 * @domain context
 * @pattern context-files-page
 * @ai-summary Deep links into the context workspace (/context/<slug>.md,
 *   and legacy /context/<slug> links).
 */
import type { Metadata } from "next";
import { ContextFilesView } from "@dashboard/lib/components/ContextFilesView";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildKodyMetadata({
  title: "Context — Kody Operations Dashboard",
  description: "Curated markdown context you feed Kody, attached to agents.",
  path: "/context",
});

export default async function ContextPathRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const joined = path.join("/");
  return (
    <ContextFilesView
      initialPath={joined.endsWith(".md") ? joined : `${joined}.md`}
    />
  );
}
