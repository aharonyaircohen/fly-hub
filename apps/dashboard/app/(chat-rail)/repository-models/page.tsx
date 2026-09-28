import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Repository Chat Models — Kody Operations Dashboard",
  description: "Manage chat models shared with everyone using this repository.",
  path: "/repository-models",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export { default } from "@kody-ade/kody-chat-dashboard/pages/repository-models";
