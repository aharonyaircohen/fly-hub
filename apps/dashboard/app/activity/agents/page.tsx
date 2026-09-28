import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ActivityPage } from "@dashboard/lib/components/ActivityPage";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;

export const metadata = buildKodyMetadata({
  title: "Agent Activity — Kody Operations Dashboard",
  description: "Inspectable coding-agent runs and MCP calls.",
  path: "/activity/agents",
});

export default function AgentActivityRoute() {
  return (
    <AuthGuard>
      <ActivityPage initialTab="agents" />
    </AuthGuard>
  );
}
