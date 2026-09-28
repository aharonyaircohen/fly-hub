/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Capability list backed by backend capabilities storage.
 */
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Capabilities — Kody Operations Dashboard",
  description: "Manage reusable Kody capabilities.",
  path: "/capabilities",
});

export default function CapabilitiesPage() {
  return null;
}
