/**
 * @fileType api-route
 * @domain user-state
 * @pattern user-state-api
 * @ai-summary GET: read the acting user's own document for a namespace.
 *   PUT: write `{ data }` through the user-state service (merge policy +
 *   schema validation + `state.entity.written` emission). Identity is
 *   resolved server-side; users can only ever touch their own document.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUserOctokit } from "../../../../../src/dashboard/lib/github-client";
import { resolveUnifiedActor, type UnifiedActor } from "../../../../../src/dashboard/lib/auth/unified-actor";
import { resolveBackgroundToken } from "@kody-ade/base/auth/background-token";
import {
  getUserState,
  setUserState,
  UserStateError,
  type UserStateServiceContext,
} from "../../../../../src/dashboard/lib/user-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const putBodySchema = z
  .object({ data: z.record(z.string(), z.unknown()) })
  .strict();

type RouteContext = { params: Promise<{ namespace: string }> };

async function buildServiceContext(
  actor: UnifiedActor,
): Promise<UserStateServiceContext | null> {
  if (!actor.brand) return null;
  const token =
    actor.token ??
    (await resolveBackgroundToken(actor.brand.owner, actor.brand.repo))?.token;
  if (!token) return null;
  return {
    octokit: createUserOctokit(token),
    owner: actor.brand.owner,
    repo: actor.brand.repo,
    userId: actor.userId,
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserStateError) {
    return NextResponse.json(
      { message: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }
  throw error;
}

export async function GET(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const actor = await resolveUnifiedActor(req);
  if (!actor) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  const ctx = await buildServiceContext(actor);
  if (!ctx) {
    return NextResponse.json(
      { message: "No repository access token available" },
      { status: 403 },
    );
  }
  const { namespace } = await context.params;
  try {
    const doc = await getUserState(ctx, namespace);
    return NextResponse.json({ doc });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const actor = await resolveUnifiedActor(req);
  if (!actor) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }
  const ctx = await buildServiceContext(actor);
  if (!ctx) {
    return NextResponse.json(
      { message: "No repository access token available" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof putBodySchema>;
  try {
    body = putBodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ message: "Invalid body" }, { status: 400 });
  }

  const { namespace } = await context.params;
  try {
    const doc = await setUserState(ctx, namespace, body.data, {
      source: "server",
    });
    return NextResponse.json({ doc });
  } catch (error) {
    return errorResponse(error);
  }
}
