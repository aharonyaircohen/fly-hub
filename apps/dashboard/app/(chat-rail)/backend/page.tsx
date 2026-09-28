/**
 * @fileType page
 * @domain kody
 * @pattern backend-page
 * @ai-summary Repository backend admin entry point — export the active repo's
 *   state data as a JSON dump and import into that repo. Renders inside the shared
 *   PageWithChat shell so the assistant is always available.
 */
import { BackendManager } from "@dashboard/features/admin/components/BackendManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Backend — Kody Operations Dashboard",
  description:
    "Export and import backend data for the selected repository.",
  path: "/backend",
});

export default function BackendPage() {
  return <BackendManager />;
}
