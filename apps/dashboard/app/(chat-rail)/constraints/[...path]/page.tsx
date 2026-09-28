import { AgentGuidanceFilesView } from "@dashboard/lib/components/AgentGuidanceFilesView";
import { CONSTRAINTS_DEFINITION } from "@dashboard/lib/agent-guidance-definitions";

export const dynamic = "force-dynamic";

export default async function ConstraintPathPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join("/");
  return <AgentGuidanceFilesView definition={CONSTRAINTS_DEFINITION} initialPath={joined.endsWith(".md") ? joined : `${joined}.md`} />;
}
