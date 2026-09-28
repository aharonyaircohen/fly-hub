import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireHubConfig, sameOrigin } from "./session";
import { listServerProviderInventory } from "../infrastructure/server-machines";
import { downloadAuthorizedMachineSsh } from "../routes/fly-machines-ssh";

const Body = z.object({
  app: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  machineId: z.string().min(1).max(120),
});

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid machine" }, { status: 400 });
  }
  try {
    const inventory = await listServerProviderInventory(auth.cfg);
    const row = inventory.machines.find(
      (machine) => machine.app === body.data.app && machine.machineId === body.data.machineId,
    );
    if (!row) {
      return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    }
    return downloadAuthorizedMachineSsh({ ...body.data, cfg: auth.cfg });
  } catch {
    return NextResponse.json({ error: "Could not download SSH settings" }, { status: 502 });
  }
}
