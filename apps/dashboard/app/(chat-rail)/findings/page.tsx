import { redirect } from "next/navigation";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Findings - Kody Operations Dashboard",
  description: "Problems recorded by the AI Agency observer.",
  path: "/findings",
});

export default function FindingsRoute() {
  redirect("/reports?type=finding");
}
