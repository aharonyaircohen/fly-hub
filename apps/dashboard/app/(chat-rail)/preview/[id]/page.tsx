/**
 * @fileType page
 * @domain preview
 * @pattern preview-selected-environment-page
 * @ai-summary Selected Preview environment route. Keeps environment selection
 * addressable at `/preview/<id>`.
 */
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "View — Kody Operations Dashboard",
  description: "View a selected saved preview environment.",
  path: "/preview",
});

export default function SelectedPreviewPage() {
  return null;
}
