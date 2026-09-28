/**
 * @fileType page
 * @domain client-chat
 * @pattern languages-page
 * @ai-summary Client language registry entry point. Manages language JSON
 *   documents stored in Convex.
 */
import { LanguagesManager } from "@kody-ade/kody-chat-dashboard/components/LanguagesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Languages — Kody Operations Dashboard",
  description: "Manage client chat translations.",
  path: "/languages",
});

export default function LanguagesPage() {
  return <LanguagesManager />;
}
