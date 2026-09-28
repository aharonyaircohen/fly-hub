import { PipelinesManager } from "@dashboard/features/pipelines/components/PipelinesManager";

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PipelinesManager selectedId={id} />;
}
