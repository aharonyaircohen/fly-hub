/** Register Dashboard-owned Markdown guides before the package chat route loads. */
import { getFeatureGuideRegistry } from "@kody-ade/kody-chat-dashboard/platform/server-feature-guides";
import { dashboardFeatureGuideProvider } from "@dashboard/lib/feature-guides/provider";

const DASHBOARD_GUIDE_PROVIDER_ID = "dashboard-host";
const registry = getFeatureGuideRegistry();

if (!registry.providerIds().includes(DASHBOARD_GUIDE_PROVIDER_ID)) {
  registry.register(DASHBOARD_GUIDE_PROVIDER_ID, dashboardFeatureGuideProvider);
}
