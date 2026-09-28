import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, verifyActorLogin } from "@kody-ade/base/auth";
import {
  resolveServerProviderContext,
  serverProviderConfigFromContext,
} from "../infrastructure/server-context";
import {
  loadTerminalInventoryAuthority,
  terminalFlyConfigForMachine,
} from "../terminal/server-inventory";
import {
  listMachines,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { readMachineSshAccess, sshPorts } from "../ssh/machine-config";
import { machineSshArchive } from "../ssh/archive";

export const runtime = "nodejs";
export const machineSshTargetSchema = z.object({
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  machineId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
});
const error = (message: string, status: number) =>
  NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store, private" } },
  );

export async function POST(req: NextRequest) {
  const denied = await requireKodyAuth(req);
  if (denied) return denied;
  const actor = await verifyActorLogin(req, undefined);
  if ("status" in actor) return actor;
  const target = machineSshTargetSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!target.success) return error("Invalid machine", 400);
  const ctx = await resolveServerProviderContext(req);
  if (!ctx.ok) return error(ctx.error, ctx.status);
  const cfg = serverProviderConfigFromContext(ctx.context);
  if (!cfg) return error("Fly credentials are missing", 503);

  try {
    const { app, machineId } = target.data;
    const { inventory, savedBrain } = await loadTerminalInventoryAuthority(
      req,
      cfg,
      target.data,
      ctx.context,
    );
    const row = inventory.machines.find(
      (machine) => machine.app === app && machine.machineId === machineId,
    );
    if (!row) return error("Machine not found", 404);
    if (
      row.feature === "brain" &&
      (savedBrain?.brain.machine?.app !== app ||
        savedBrain.brain.machine.machineId !== machineId)
    ) {
      return error("This Brain belongs to another user", 403);
    }
    return downloadAuthorizedMachineSsh({
      app,
      machineId,
      cfg: terminalFlyConfigForMachine(cfg, row, savedBrain),
      ...(row.feature === "browser"
        ? { browserActor: actor.identity.login }
        : {}),
    });
  } catch {
    // Provider errors can contain configuration; never return them with keys.
    return error("Could not download SSH settings", 500);
  }
}

/** Used only after the owning feature has authorized this exact machine. */
export async function downloadAuthorizedMachineSsh(input: {
  app: string;
  machineId: string;
  cfg: FlyPreviewConfig;
  browserActor?: string;
}) {
  try {
    const { app, machineId } = machineSshTargetSchema.parse(input);
    const machines = await listMachines(app, input.cfg);
    const machine = machines.find((item) => item.id === machineId);
    if (!machine) return error("Machine not found", 404);
    if (
      input.browserActor !== undefined &&
      machine.config?.env?.KODY_BROWSER_ACTOR_ID !== input.browserActor
    ) {
      return error("This browser belongs to another user", 403);
    }
    const access = readMachineSshAccess(machine.config);
    if (!access)
      return error(
        "SSH download is unavailable for this machine. It requires a machine created with SSH support.",
        409,
      );
    if (
      machines.some(
        (other) =>
          other.id !== machineId &&
          sshPorts(other.config).includes(access.port),
      )
    ) {
      return error("This machine's SSH port is already in use", 409);
    }
    const archive = machineSshArchive({ app, machineId, access });
    return new NextResponse(new Uint8Array(archive.bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return error("Could not download SSH settings", 500);
  }
}
