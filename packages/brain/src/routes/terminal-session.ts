/** Personal Brain terminal: use the same account, token, and machine as provisioning. */
import { NextRequest, NextResponse } from "next/server";
import { TerminalSessionRequestSchema } from "@kody-ade/fly/routes/terminal-session";
import {
  connectTerminalMachine,
  TerminalSessionError,
} from "@kody-ade/fly/terminal/session-connect";
import { resolvePersonalBrainContext } from "../personal-context";
import { resolveBrainService } from "../service-resolver";

export async function POST(req: NextRequest) {
  let resolved: Awaited<ReturnType<typeof resolvePersonalBrainContext>>;
  try {
    resolved = await resolvePersonalBrainContext();
  } catch (error) {
    const diagnostic = (error instanceof Error ? error.message : String(error))
      .replace(/FlyV1[^\s"']+/g, "[redacted-token]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted-token]")
      .slice(0, 240);
    return NextResponse.json(
      {
        error: "terminal_context_failed",
        message: `Could not load Brain terminal credentials. ${diagnostic || "Try again."}`,
      },
      { status: 503 },
    );
  }
  if (!resolved.ok)
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  const { context } = resolved;
  if (!context.flyToken) {
    return NextResponse.json(
      {
        error: "fly_token_missing",
        message:
          "Add a Fly token to Personal Credentials to connect your Brain.",
      },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = TerminalSessionRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  if (parsed.data.target !== "brain" && parsed.data.feature !== "brain") {
    return NextResponse.json(
      {
        error: "machine_not_terminal_capable",
        message: "Only your personal Brain can open this terminal.",
      },
      { status: 403 },
    );
  }
  try {
    // Never take account, app, machine, or credentials from repository headers
    // or a stale client selection. Brain's current personal record owns them.
    const resolveService = () =>
      resolveBrainService({
        account: context.account,
        githubToken: context.githubToken,
        flyToken: context.flyToken!,
        orgSlug: context.flyOrgSlug,
        defaultRegion: context.flyDefaultRegion,
      });
    const brain = await resolveService();
    if (brain.reason === "fly_access_denied") {
      throw new TerminalSessionError(
        "fly_access_denied",
        "Fly token cannot access your Brain app.",
        403,
      );
    }
    if (!brain.machine) {
      throw new TerminalSessionError(
        "machine_not_found",
        "Your personal Brain machine could not be found. Check its status on the Brain page.",
        404,
      );
    }
    return NextResponse.json(
      await connectTerminalMachine({
        scope: { owner: context.account, repo: "personal-brain" },
        workspace: "machine",
        cfg: {
          token: brain.flyToken,
          orgSlug: brain.orgSlug,
          defaultRegion: brain.defaultRegion,
        },
        machine: brain.machine,
        data: parsed.data,
        refreshMachine: async () => (await resolveService()).machine ?? null,
      }),
    );
  } catch (error) {
    if (error instanceof TerminalSessionError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    const diagnostic = (error instanceof Error ? error.message : String(error))
      .replace(/FlyV1[^\s"']+/g, "[redacted-token]")
      .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted-token]")
      .slice(0, 240);
    return NextResponse.json(
      {
        error: "terminal_session_failed",
        message: `Could not connect to your Brain terminal. ${diagnostic || "Try again."}`,
      },
      { status: 503 },
    );
  }
}
