/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Repo-scoped dashboard home (`/repo/<owner>/<repo>`). This used
 *   to be served through the next.config rewrite to `/`, but on Vercel the
 *   client router's RSC request for a rewritten URL whose destination is the
 *   prerendered root returns 500, so every sidebar navigation to the home
 *   fell back to a full-page load (chat rail remounted, conversation state
 *   flashed away). A real route keeps the navigation soft; the rewrite still
 *   covers `/repo/<owner>/<repo>/<page>` subpaths. Rendering matches
 *   app/page.tsx minus the force-static OG directives — those only matter on
 *   the bare `/`, which social crawlers hit.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DashboardHome } from "@dashboard/lib/components/DashboardHome";
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Happening now",
  description:
    "Monitor and manage AI coding agent tasks, pipelines, and deployments",
  path: "/",
});

export default function RepoScopedHomePage() {
  return (
    <AuthGuard>
      <DashboardHome />
    </AuthGuard>
  );
}
