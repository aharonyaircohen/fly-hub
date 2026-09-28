/**
 * @fileType page
 * @domain kody
 * @pattern agent-selected-page
 * @ai-summary Selected Agent route. Keeps agent selection addressable at
 * `/agents/<slug>`.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentsControl } from "@dashboard/lib/components/AgentsControl";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Agent - Kody Operations Dashboard",
  description: "View a selected Kody agent.",
  path: "/agents",
});

export default async function SelectedAgentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <AgentsControl selectedSlug={slug} />
    </AuthGuard>
  );
}
