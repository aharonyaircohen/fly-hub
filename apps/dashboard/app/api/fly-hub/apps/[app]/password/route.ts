import crypto from "node:crypto";
import { decrypt, encrypt } from "@kody-ade/base/vault/crypto";
import { NextRequest, NextResponse } from "next/server";
import { flyHubAppName } from "@kody-ade/fly/hub/app-source";
import { requireHubConfig, sameOrigin } from "@kody-ade/fly/hub/session";
import { readEvePlanHandle } from "../../agent/route";
import { readFlyHubEveTask } from "@dashboard/lib/fly-hub-eve-task";
import {
  listMachines,
  updateMachineEnv,
} from "@kody-ade/fly/apps/machines-client";

import {
  assertFlyHubAppOwned,
  AppOwnershipError,
} from "@kody-ade/fly/hub/app-ownership";

export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "no-store, private" };

// Recover the original password of an older app when its setup run is known.
export async function PATCH(
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
  const body = (await req.json().catch(() => null)) as {
    runHandle?: unknown;
  } | null;
  if (typeof body?.runHandle !== "string" || body.runHandle.length > 4_096)
    return NextResponse.json({ error: "Invalid setup run." }, { status: 400 });
  try {
    const handle = readEvePlanHandle(body.runHandle, auth.cfg.orgSlug);
    const task =
      handle.taskGrant &&
      readFlyHubEveTask(handle.taskGrant, { allowExpired: true });
    if (
      !task ||
      task.orgSlug !== auth.cfg.orgSlug ||
      task.token !== auth.cfg.token
    )
      return NextResponse.json(
        { error: "Invalid setup run." },
        { status: 403 },
      );
    const [owner, repo] = task.repository.split("/");
    if (flyHubAppName(task.orgSlug, owner, repo, ".") !== app)
      return NextResponse.json(
        { error: "This run belongs to another app." },
        { status: 403 },
      );
    await assertFlyHubAppOwned(app, auth.cfg);
    const machines = await listMachines(app, auth.cfg);
    const gateway = machines.find(
      (machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH,
    );
    if (!gateway)
      return NextResponse.json({ error: "App not found." }, { status: 404 });
    const password = (label: string) =>
      crypto
        .createHmac("sha256", Buffer.from(task.passwordSeed, "hex"))
        .update(label)
        .digest("base64url")
        .slice(0, 32);
    const outer = password("outer");
    if (
      crypto.createHash("sha256").update(outer).digest("hex") !==
      gateway.config?.env?.FLY_HUB_PASSWORD_HASH
    )
      return NextResponse.json(
        {
          error: "The password was changed after this run. Use Reset password.",
        },
        { status: 409 },
      );
    const appCredentialName = gateway.config?.env?.FLY_HUB_APP_PASSWORD_ENV;
    const appCredential = appCredentialName
      ? { name: appCredentialName, password: password("inner") }
      : null;
    await updateMachineEnv(
      app,
      gateway.id,
      {
        FLY_HUB_PASSWORD_ENCRYPTED: encrypt(outer),
        ...(appCredential
          ? { FLY_HUB_APP_PASSWORD_ENCRYPTED: encrypt(appCredential.password) }
          : {}),
      },
      auth.cfg,
    );
    return NextResponse.json(
      { password: outer, appCredential },
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof AppOwnershipError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    return NextResponse.json(
      { error: "Could not recover this app password." },
      { status: 502, headers: privateHeaders },
    );
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ app: string }> },
) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const { app } = await context.params;
  if (!/^flyhub-app-[a-z0-9-]+-[a-f0-9]{12}$/.test(app))
    return NextResponse.json({ error: "App not found." }, { status: 404 });
  try {
    await assertFlyHubAppOwned(app, auth.cfg);
    const machines = await listMachines(app, auth.cfg);
    const gateway = machines.find(
      (machine) => machine.config?.env?.FLY_HUB_PASSWORD_HASH,
    );
    if (!gateway)
      return NextResponse.json({ error: "App not found." }, { status: 404 });
    const env = gateway.config?.env ?? {};
    if (!env.FLY_HUB_PASSWORD_ENCRYPTED)
      return NextResponse.json(
        {
          error:
            "This app predates password recovery. Reset its password to save a recoverable one.",
        },
        { status: 409, headers: privateHeaders },
      );
    const password = decrypt(env.FLY_HUB_PASSWORD_ENCRYPTED);
    const hash = crypto.createHash("sha256").update(password).digest("hex");
    if (hash !== env.FLY_HUB_PASSWORD_HASH)
      return NextResponse.json(
        {
          error:
            "The stored password no longer matches this app. Reset it to get a new one.",
        },
        { status: 409, headers: privateHeaders },
      );
    const appCredential =
      env.FLY_HUB_APP_PASSWORD_ENV && env.FLY_HUB_APP_PASSWORD_ENCRYPTED
        ? {
            name: env.FLY_HUB_APP_PASSWORD_ENV,
            password: decrypt(env.FLY_HUB_APP_PASSWORD_ENCRYPTED),
          }
        : null;
    return NextResponse.json(
      { password, appCredential },
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof AppOwnershipError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    return NextResponse.json(
      { error: "Could not retrieve app password. Reset it to get a new one." },
      { status: 502, headers: privateHeaders },
    );
  }
}

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
    await assertFlyHubAppOwned(app, auth.cfg);
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
      {
        FLY_HUB_PASSWORD_HASH: hash,
        FLY_HUB_PASSWORD_ENCRYPTED: encrypt(password),
      },
      auth.cfg,
    );
    return NextResponse.json(
      {
        password,
        message:
          "Save this password now. Previous passwords and sessions have been revoked.",
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    if (error instanceof AppOwnershipError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      );
    return NextResponse.json(
      { error: "Could not reset app password." },
      { status: 502 },
    );
  }
}
