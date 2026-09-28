import type { Metadata } from "next";
import { PipelinesManager } from "@dashboard/features/pipelines/components/PipelinesManager";

export const metadata: Metadata = { title: "Pipelines - Kody Operations Dashboard" };

export default function PipelinesPage() {
  return <PipelinesManager />;
}
