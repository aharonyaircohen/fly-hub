import { ThemesManager } from "@kody-ade/kody-chat-dashboard/components/ThemesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Client Theme — Kody Operations Dashboard",
  description: "Edit the complete client chat appearance for a brand.",
  path: "/themes",
});

export default async function SelectedThemePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ThemesManager selectedSlug={slug} />;
}
