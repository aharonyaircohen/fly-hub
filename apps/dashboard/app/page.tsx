/**
 * @fileType page
 * @domain runner
 * @pattern fly-hub-home
 * @ai-summary Fly Hub root redirects to the Machines page.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export default function FlyHubPage() {
  redirect("/fly/machines");
}
