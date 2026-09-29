import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import {
  listMachines,
  updateMachineEnv,
} from "@kody-ade/fly/apps/machines-client";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ app: string }> },
) {
  if (!sameOrigin(req))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const { app } = await context.params;
  if (!/^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/.test(app))
    return NextResponse.json({ error: "App not found." }, { status: 404 });
  try {
    const machines = await listMachines(app, auth.cfg);
    const gateway = machines.find(
      (machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH,
    );
    if (!gateway)
      return NextResponse.json({ error: "App not found." }, { status: 404 });
    const password = crypto.randomBytes(24).toString("base64url");
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    await updateMachineEnv(
      app,
      gateway.id,
      { FLY_HUB_PASSWORD_HASH: hash },
      auth.cfg,
    );
    return NextResponse.json(
      {
        password,
        message:
          "Save this password now. Previous passwords and sessions have been revoked.",
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not reset app password." },
      { status: 502 },
    );
  }
}
