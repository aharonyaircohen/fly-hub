import { FlyMcpSettings } from "../../../FlyMcpSettings";
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Fly Settings",
  description: "Configure MCP access to Fly Hub.",
  path: "/fly/settings",
});

export default function FlySettingsPage() {
  return <FlyMcpSettings />;
}
