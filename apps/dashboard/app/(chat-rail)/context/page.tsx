/**
 * @fileType page
 * @domain context
 * @pattern context-files-page
 * @ai-summary Context page — the generic file-manager workspace over the
 *   context store (markdown entries with agent audience in the header).
 */
import type { Metadata } from "next";
import { ContextFilesView } from "@dashboard/lib/components/ContextFilesView";
import { buildKodyMetadata } from "../../metadata";

export const metadata: Metadata = buildKodyMetadata({
  title: "Context — Kody Operations Dashboard",
  description: "Curated markdown context you feed Kody, attached to agents.",
  path: "/context",
});

export default function ContextPage() {
  return <ContextFilesView />;
}
