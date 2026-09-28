/**
 * @fileType page
 * @domain todos
 * @pattern todos-selected-page
 * @ai-summary Selected todo-list route. Keeps list selection addressable at
 * `/todos/<slug>` while reusing the shared todos manager.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { TodoControl } from "@dashboard/features/tasks/components/TodoControl";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Todo — Kody Operations Dashboard",
  description: "View a selected repo-scoped todo list.",
  path: "/todos",
});

export default async function SelectedTodoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <TodoControl selectedSlug={slug} />
    </AuthGuard>
  );
}
