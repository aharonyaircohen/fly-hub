import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ChatModelsSchema } from "@kody-ade/base/variables/models";
import {
  getLocalTerminalSessionInfoByChatSession,
  startLocalTerminalSession,
  writeLocalTerminalInput,
} from "@kody-ade/terminal/local-chat-session";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  backendApi,
  getConvexClient,
} from "@dashboard/lib/backend/convex-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  modelId: z.string().trim().min(1).max(200),
  action: z.enum(["start", "stop", "status"]),
});

type ServiceStatus = "ready" | "loading" | "stopped";

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function serviceSessionId(modelId: string): string {
  let hash = 2166136261;
  for (const char of modelId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `model-service-${(hash >>> 0).toString(36)}`;
}

async function localServiceStatus(baseURL: string): Promise<ServiceStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const url = new URL(baseURL);
    if (!isLoopback(url.hostname)) return "stopped";
    url.pathname = "/health";
    url.search = "";
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok ? "ready" : "loading";
  } catch {
    return "stopped";
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;
  if (!isLoopback(req.nextUrl.hostname)) {
    return NextResponse.json(
      {
        error: "local_service_unavailable",
        message: "Local services can only run from a local dashboard.",
      },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 400 });
  }

  const stored = await getConvexClient().query(backendApi.userPreferences.get, {
    namespace: "chat-models",
    userKey: actor.id,
  });
  const models = ChatModelsSchema.safeParse(
    stored?.data && typeof stored.data === "object"
      ? (stored.data as { models?: unknown }).models
      : undefined,
  );
  const model = models.success
    ? models.data.find((item) => item.id === parsed.data.modelId)
    : undefined;
  if (!model?.service || model.service.machine !== "local") {
    return NextResponse.json(
      { error: "local_service_not_found" },
      { status: 404 },
    );
  }

  if (parsed.data.action === "status") {
    return NextResponse.json({
      ok: true,
      status: await localServiceStatus(model.adapterBaseURL ?? model.baseURL),
    });
  }

  const auth = { owner: `account-${actor.id}`, repo: "model-services" };
  const chatSessionId = serviceSessionId(model.id);
  const session =
    getLocalTerminalSessionInfoByChatSession(chatSessionId, auth) ??
    (await startLocalTerminalSession({ ...auth, chatSessionId }));
  if (parsed.data.action === "stop") {
    writeLocalTerminalInput(session.sessionId, auth, "\u0003", { raw: true });
  }
  const command =
    parsed.data.action === "start"
      ? model.service.startCommand
      : model.service.stopCommand;
  if (!writeLocalTerminalInput(session.sessionId, auth, command)) {
    return NextResponse.json(
      { error: "local_service_command_failed" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}
