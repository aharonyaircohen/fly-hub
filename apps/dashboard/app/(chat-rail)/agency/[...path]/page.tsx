import type { Metadata } from "next";
import { IntentFilesView } from "@dashboard/features/agency/components/IntentFilesView";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildKodyMetadata({
  title: "Intents — Kody Operations Dashboard",
  description: "Manage the Agency's plain-text intents.",
  path: "/agency",
});

export default async function IntentPathRoute({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const joined = path.join("/");
  return (
    <IntentFilesView
      initialPath={joined.endsWith(".md") ? joined : `${joined}.md`}
    />
  );
}
