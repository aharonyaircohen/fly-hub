import { FlyAppsManager } from "@dashboard/features/previews/components/FlyAppsManager";
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Fly Apps",
  description:
    "Deploy password-protected apps from public GitHub repositories.",
  path: "/fly/apps",
});

export default function FlyAppsPage() {
  return <FlyAppsManager />;
}
