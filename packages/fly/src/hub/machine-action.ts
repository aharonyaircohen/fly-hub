import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireHubConfig, sameOrigin } from "./session";
import {
  destroyApp,
  destroyMachine,
  listServerProviderInventory,
  startServerProviderMachine,
  suspendMachine,
} from "../infrastructure/server-machines";

const Body = z.object({
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  machineId: z.string().min(1).max(120),
  action: z.enum(["suspend", "start", "destroy", "destroyApp"]),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid machine action" }, { status: 400 });
  }
  try {
    const inventory = await listServerProviderInventory(auth.cfg);
    const row = inventory.machines.find(
      (machine) => machine.app === body.data.app && machine.machineId === body.data.machineId,
    );
    if (!row) {
      return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    }
    const { app, machineId, action } = body.data;
    if (action === "suspend") await suspendMachine(app, machineId, auth.cfg);
    if (action === "start") await startServerProviderMachine(app, machineId, auth.cfg);
    if (action === "destroy") await destroyMachine(app, machineId, auth.cfg);
    if (action === "destroyApp") await destroyApp(app, auth.cfg);
    return NextResponse.json({ ok: true, app, machineId, action });
  } catch {
    return NextResponse.json({ error: "Fly could not complete this action." }, { status: 502 });
  }
}
