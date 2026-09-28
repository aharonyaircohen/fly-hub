import { ThemesManager } from "@kody-ade/kody-chat-dashboard/components/ThemesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Client Themes — Kody Operations Dashboard",
  description: "Manage the complete client chat appearance for each brand.",
  path: "/themes",
});

export default function ThemesPage() {
  return <ThemesManager />;
}
