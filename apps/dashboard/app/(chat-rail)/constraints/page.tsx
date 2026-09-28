import type { Metadata } from "next";
import { AgentGuidanceFilesView } from "@dashboard/lib/components/AgentGuidanceFilesView";
import { CONSTRAINTS_DEFINITION } from "@dashboard/lib/agent-guidance-definitions";
import { buildKodyMetadata } from "../../metadata";

export const metadata: Metadata = buildKodyMetadata({
  title: "Constraints — Kody Operations Dashboard",
  description: "Hard limits assigned to specific agents.",
  path: "/constraints",
});

export default function ConstraintsPage() {
  return <AgentGuidanceFilesView definition={CONSTRAINTS_DEFINITION} />;
}
