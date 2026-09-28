import { buildKodyMetadata } from "../../../metadata";
import { MemoryFilesPage } from "@dashboard/features/memory/components/MemoryFilesPage";

export const metadata = buildKodyMetadata({
  title: "Memory — Kody Operations Dashboard",
  description: "Manage what Kody remembers for your account.",
  path: "/memory",
});

export default async function MemoryPage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path = [] } = await params;
  return <MemoryFilesPage initialPath={path.join("/")} />;
}
