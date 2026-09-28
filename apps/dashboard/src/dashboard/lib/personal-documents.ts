import "server-only";

import { backendApi, getConvexClient } from "./backend/convex-backend";

export type PersonalCommand = Readonly<{
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
  source: "personal";
  sha: "";
  updatedAt: string;
  htmlUrl: "";
}>;

type RepoDoc<T> = { kind: string; doc: T; updatedAt: string };

const COMMAND_PREFIX = "command:";
const INSTRUCTIONS_KIND = "instructions";

export async function listPersonalCommands(tenantId: string) {
  const rows = (await getConvexClient().query(backendApi.repoDocs.listByPrefix, {
    tenantId,
    prefix: COMMAND_PREFIX,
  })) as RepoDoc<{ description?: string; argumentHint?: string; body: string }>[];
  return rows.map((row): PersonalCommand => ({
    slug: row.kind.slice(COMMAND_PREFIX.length),
    description: row.doc.description ?? "",
    argumentHint: row.doc.argumentHint ?? "",
    body: row.doc.body,
    source: "personal",
    sha: "",
    updatedAt: row.updatedAt,
    htmlUrl: "",
  }));
}

export async function readPersonalCommand(tenantId: string, slug: string) {
  const row = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId,
    kind: `${COMMAND_PREFIX}${slug}`,
  })) as RepoDoc<{ description?: string; argumentHint?: string; body: string }> | null;
  if (!row) return null;
  return {
    slug,
    description: row.doc.description ?? "",
    argumentHint: row.doc.argumentHint ?? "",
    body: row.doc.body,
    source: "personal" as const,
    sha: "" as const,
    updatedAt: row.updatedAt,
    htmlUrl: "" as const,
  };
}

export async function savePersonalCommand(
  tenantId: string,
  command: Pick<PersonalCommand, "slug" | "description" | "argumentHint" | "body">,
) {
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId,
    kind: `${COMMAND_PREFIX}${command.slug}`,
    doc: {
      description: command.description,
      argumentHint: command.argumentHint,
      body: command.body,
    },
    updatedAt,
  });
  return { ...command, source: "personal" as const, sha: "" as const, updatedAt, htmlUrl: "" as const };
}

export async function removePersonalCommand(tenantId: string, slug: string) {
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId,
    kind: `${COMMAND_PREFIX}${slug}`,
  });
}

export async function readPersonalInstructions(tenantId: string) {
  const row = (await getConvexClient().query(backendApi.repoDocs.get, {
    tenantId,
    kind: INSTRUCTIONS_KIND,
  })) as RepoDoc<{ body: string }> | null;
  return row
    ? { body: row.doc.body, sha: "", updatedAt: row.updatedAt, htmlUrl: "" }
    : null;
}

export async function savePersonalInstructions(tenantId: string, body: string) {
  const updatedAt = new Date().toISOString();
  await getConvexClient().mutation(backendApi.repoDocs.save, {
    tenantId,
    kind: INSTRUCTIONS_KIND,
    doc: { body },
    updatedAt,
  });
  return { body, sha: "", updatedAt, htmlUrl: "" };
}

export async function removePersonalInstructions(tenantId: string) {
  await getConvexClient().mutation(backendApi.repoDocs.remove, {
    tenantId,
    kind: INSTRUCTIONS_KIND,
  });
}
