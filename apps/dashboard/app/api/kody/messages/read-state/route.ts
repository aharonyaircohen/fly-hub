/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern channels-read-state
 * @ai-summary Per-user channel read-state. GET returns `{ baseline, seen }`
 *   (channelNumber → last-opened ISO); POST `{ channelNumber }` stamps that
 *   channel as seen now. State lives in Convex, keyed by tenant and user.
 *
 *   Auth: the user PAT is used only to identify the signed-in GitHub user.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getRequestAuth,
  getUserOctokit,
} from "@kody-ade/base/auth";
import {
  readChannelsSeen,
  markChannelSeen,
} from "@dashboard/lib/messages/channels-seen-convex";

const postSchema = z.object({
  channelNumber: z.number().int().positive(),
});

export async function GET(req: NextRequest) {
  const authErr = await requireKodyAuth(req);
  if (authErr) return authErr;
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required", message: "Missing repo auth headers" },
      { status: 401 },
    );
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "auth_required", message: "No octokit instance" },
      { status: 401 },
    );
  }

  try {
    const manifest = await readChannelsSeen(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
    );
    return NextResponse.json(
      { baseline: manifest.baseline, seen: manifest.seen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "read_failed",
        message: err instanceof Error ? err.message : "read failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authErr = await requireKodyAuth(req);
  if (authErr) return authErr;
  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json(
      { error: "auth_required", message: "Missing repo auth headers" },
      { status: 401 },
    );
  }
  const octokit = await getUserOctokit(req);
  if (!octokit) {
    return NextResponse.json(
      { error: "auth_required", message: "No octokit instance" },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_json", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: "Invalid channelNumber",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const manifest = await markChannelSeen(
      octokit,
      headerAuth.owner,
      headerAuth.repo,
      parsed.data.channelNumber,
      new Date().toISOString(),
    );
    return NextResponse.json(
      { baseline: manifest.baseline, seen: manifest.seen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "write_failed",
        message: err instanceof Error ? err.message : "write failed",
      },
      { status: 500 },
    );
  }
}
