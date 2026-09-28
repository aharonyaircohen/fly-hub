import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ActivityPage } from "@dashboard/lib/components/ActivityPage";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Agent Run — Kody Operations Dashboard",
  description: "One inspectable coding-agent run and its MCP calls.",
  path: "/activity/agents",
});

export default async function AgentRunActivityRoute({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <AuthGuard>
      <ActivityPage initialTab="agents" initialAgentRunId={runId} />
    </AuthGuard>
  );
}
