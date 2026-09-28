/**
 * @fileType page
 * @domain kody
 * @pattern agency-runs-page
 * @ai-summary Agency Runs page for Kody-native loop and workflow runs.
 */

import { AgencyRunsPage } from "@dashboard/features/agency/components/AgencyRunsPage";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Agency Runs - Kody Operations Dashboard",
  description: "Kody-native loop and workflow runs.",
  path: "/agency-runs",
});

export default function AgencyRunsRoute() {
  return <AgencyRunsPage />;
}
