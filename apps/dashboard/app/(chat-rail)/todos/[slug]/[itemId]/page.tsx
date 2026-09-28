/**
 * @fileType page
 * @domain todos
 * @pattern todos-selected-item-page
 * @ai-summary Selected todo-item route. Keeps an item inside a todo list
 * addressable at `/todos/<slug>/<itemId>` while reusing the shared manager.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { TodoControl } from "@dashboard/features/tasks/components/TodoControl";
import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Todo item — Kody Operations Dashboard",
  description: "View a selected item inside a repo-scoped todo list.",
  path: "/todos",
});

export default async function SelectedTodoItemPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  return (
    <AuthGuard>
      <TodoControl selectedSlug={slug} selectedItemId={itemId} />
    </AuthGuard>
  );
}
