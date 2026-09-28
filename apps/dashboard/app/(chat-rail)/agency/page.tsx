import { IntentFilesView } from "@dashboard/features/agency/components/IntentFilesView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Intents — Kody Operations Dashboard",
  description: "Manage the Agency's plain-text intents.",
  path: "/agency",
});

export default function AgencyPage() {
  return <IntentFilesView />;
}
