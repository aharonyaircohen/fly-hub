import { FileSpaceView } from "@dashboard/features/file-spaces/FileSpaceView";
import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "File space — Kody Operations Dashboard",
  description: "Focused repository markdown workspace.",
  path: "/file-spaces",
});

export default async function FileSpacePage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
}) {
  const { slug, path } = await params;
  return <FileSpaceView slug={slug} path={path} />;
}
