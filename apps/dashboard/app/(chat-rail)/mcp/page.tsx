import { McpConnectionsManager } from "@dashboard/features/admin/components/McpConnectionsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Agent connections — Kody Operations Dashboard",
  description: "Connect any standards-compliant MCP coding agent to Kody.",
  path: "/mcp",
});

export default function McpPage() {
  return <McpConnectionsManager />;
}
