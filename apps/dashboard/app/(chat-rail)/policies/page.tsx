import type { Metadata } from "next";
import { AgentGuidanceFilesView } from "@dashboard/lib/components/AgentGuidanceFilesView";
import { POLICIES_DEFINITION } from "@dashboard/lib/agent-guidance-definitions";
import { buildKodyMetadata } from "../../metadata";

export const metadata: Metadata = buildKodyMetadata({
  title: "Policies — Kody Operations Dashboard",
  description: "Decision rules assigned to specific agents.",
  path: "/policies",
});

export default function PoliciesPage() {
  return <AgentGuidanceFilesView definition={POLICIES_DEFINITION} />;
}
