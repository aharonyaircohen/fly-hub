/**
 * @fileType util
 * @domain todos
 * @pattern chat-tools
 * @ai-summary Chat tools to manage repo-scoped todo lists stored as
 * `todos/<slug>.json` in Convex. A todo document is one list; each list owns note-like
 * items with independent completed state.
 */
import { tool } from "ai";
import { z } from "zod";
import { routes, type RepoRef } from "@kody-ade/base/routes";
import type { InternalLink } from "@kody-ade/base/internal-links";
import { agencyRequestStateSchema } from "../todos/agency-request-schema";

interface Ctx {
  owner: string;
  repo: string;
  listTodos(): Promise<unknown>;
  readTodo(slug: string): Promise<unknown>;
  saveTodo(input: z.infer<typeof todoWriteSchema>): Promise<unknown>;
  patchTodo(
    slug: string,
    input: { agencyRequest: z.infer<typeof agencyRequestStateSchema> },
  ): Promise<unknown>;
  validateAgencyExecution(
    execution: NonNullable<
      z.infer<typeof agencyRequestStateSchema>["execution"]
    >,
  ): Promise<{
    execution: NonNullable<
      z.infer<typeof agencyRequestStateSchema>["execution"]
    >;
    issues: string[];
  }>;
  runAgencyRequest(slug: string): Promise<unknown>;
  removeTodo(slug: string): Promise<unknown>;
}

const todoItemSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().trim().min(1).max(160),
  body: z.string().max(20_000).default(""),
  assignee: z.string().trim().max(120).nullable().optional(),
  completed: z.boolean().default(false),
  createdAt: z.string().optional(),
  completedAt: z.string().nullable().optional(),
});

const todoWriteSchema = z.object({
  slug: z.string().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(20_000).optional(),
  items: z.array(todoItemSchema).max(200).default([]),
  agencyRequest: agencyRequestStateSchema.optional(),
});

function isValidTodoSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

function todoSlugFromResult(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const todo = (value as { todo?: unknown }).todo;
  if (!todo || typeof todo !== "object" || Array.isArray(todo)) return null;
  const slug = (todo as { slug?: unknown }).slug;
  return typeof slug === "string" && isValidTodoSlug(slug) ? slug : null;
}

function withTodoLink(value: unknown, ref: RepoRef, slug: string | null) {
  if (!slug) return value;
  const link: InternalLink = {
    href: routes.repoTodoList(ref, slug),
    label: `Open todo: ${slug}`,
  };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const todo =
      record.todo &&
      typeof record.todo === "object" &&
      !Array.isArray(record.todo)
        ? { ...(record.todo as Record<string, unknown>), htmlUrl: link.href }
        : record.todo;
    return { ...record, ...(todo ? { todo } : {}), internalLinks: [link] };
  }
  return { result: value, internalLinks: [link] };
}

function withTodoListLinks(value: unknown, ref: RepoRef) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.todos)) return value;

  const internalLinks: InternalLink[] = [];
  const todos = record.todos.map((todo) => {
    if (!todo || typeof todo !== "object" || Array.isArray(todo)) {
      return todo;
    }
    const item = todo as Record<string, unknown>;
    const slug = typeof item.slug === "string" ? item.slug : null;
    if (!slug || !isValidTodoSlug(slug)) return todo;
    const link: InternalLink = {
      href: routes.repoTodoList(ref, slug),
      label: `Open todo: ${slug}`,
    };
    internalLinks.push(link);
    return { ...item, htmlUrl: link.href };
  });

  return {
    ...record,
    todos,
    ...(internalLinks.length > 0 ? { internalLinks } : {}),
  };
}

export function createTodoTools(ctx: Ctx) {
  const repoRef = `${ctx.owner}/${ctx.repo}`;

  return {
    list_todo_lists: tool({
      description: `List todo lists in ${repoRef} through the same Dashboard API used by the Todos page.`,
      inputSchema: z.object({}),
      execute: async () => {
        return withTodoListLinks(
          await ctx.listTodos(),
          { owner: ctx.owner, repo: ctx.repo },
        );
      },
    }),

    read_todo_list: tool({
      description: `Read one todo list from ${repoRef} in full, including note-like items and each item's completed state.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        const result = await ctx.readTodo(slug);
        return withTodoLink(result, { owner: ctx.owner, repo: ctx.repo }, slug);
      },
    }),

    create_or_update_todo_list: tool({
      description:
        `Create or replace a todo list in ${repoRef}. Use this to add/edit/delete/reorder items, ` +
        "or mark individual items complete/reopened. Pass the full desired items array.",
      inputSchema: todoWriteSchema,
      execute: async (input) => {
        if (input.slug && !isValidTodoSlug(input.slug)) {
          return { error: `invalid slug "${input.slug}"` };
        }
        const result = await ctx.saveTodo(input);
        return withTodoLink(
          result,
          { owner: ctx.owner, repo: ctx.repo },
          input.slug ?? todoSlugFromResult(result),
        );
      },
    }),

    update_agency_request: tool({
      description:
        `Update the lifecycle of one Agency request Todo in ${repoRef}. ` +
        "Read the Todo first, preserve the user's requirement and source exactly, and update phase, questions, plan, execution, evidence, blockers, and related Agency resources. waiting-approval requires the exact verified Workflow id and validated input in execution. Use waiting-information only for a real user decision, running/monitoring after approval, done only with end-to-end evidence, and blocked only with a precise blocker.",
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        agencyRequest: agencyRequestStateSchema,
      }),
      execute: async ({ slug, agencyRequest }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        if (
          agencyRequest.phase === "waiting-approval" &&
          !agencyRequest.execution
        ) {
          return {
            error:
              "waiting-approval requires execution.workflowId and validated input",
          };
        }
        if (
          agencyRequest.phase === "waiting-approval" &&
          agencyRequest.execution
        ) {
          const validation = await ctx.validateAgencyExecution(
            agencyRequest.execution,
          );
          if (validation.issues.length > 0) {
            return {
              error: `Agency execution is invalid: ${validation.issues.join("; ")}`,
            };
          }
          return ctx.patchTodo(slug, {
            agencyRequest: {
              ...agencyRequest,
              execution: validation.execution,
            },
          });
        }
        const result = await ctx.patchTodo(slug, { agencyRequest });
        return withTodoLink(result, { owner: ctx.owner, repo: ctx.repo }, slug);
      },
    }),

    run_agency_request: tool({
      description:
        `Start one approved Agency request in ${repoRef}. ` +
        "The server reads the saved Workflow and inputs from the Todo, dispatches it once, records the Run, and moves the request to monitoring.",
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.runAgencyRequest(slug);
      },
    }),

    delete_todo_list: tool({
      description: `Delete one todo list from ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
      }),
      execute: async ({ slug }) => {
        if (!isValidTodoSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.removeTodo(slug);
      },
    }),
  };
}
