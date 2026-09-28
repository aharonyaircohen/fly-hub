/**
 * @fileType api-endpoint
 * @domain brain
 * @pattern brain-terminal-setup
 *
 * Explicitly upgrades the active Brain machine to the current terminal-capable
 * image and installs its stateless terminal gateway. Reconnect never calls this
 * route; only the visible user setup action may replace the Brain machine.
 */
import { NextRequest, NextResponse } from "next/server";

import { logger } from "@kody-ade/base/logger";
import { requestOrigin } from "@kody-ade/base/request-origin";
import { resolvePersonalBrainContext } from "../personal-context";

import { BrainCommandError, manageBrainServer } from "../server-commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const resolved = await resolvePersonalBrainContext();
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const replaceExistingMachine =
      body.reason === "terminal_agent_missing" ||
      body.reason === "terminal_agent_unavailable";
    return NextResponse.json(
      await manageBrainServer({
        command: "setup-terminal",
        context: resolved.context,
        dashboardUrl: requestOrigin(req),
        replaceExistingMachine,
      }),
    );
  } catch (error) {
    logger.error(
      {
        error,
        userId: resolved.context.userId,
      },
      "brain terminal setup failed",
    );
    if (error instanceof BrainCommandError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          error: "fly_access_denied",
          message: "Fly token cannot access this Brain app.",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      {
        error: "terminal_setup_failed",
        message: "Terminal setup failed. Try again.",
      },
      { status: 500 },
    );
  }
}
