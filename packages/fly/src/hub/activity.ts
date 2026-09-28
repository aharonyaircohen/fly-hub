import { NextRequest, NextResponse } from "next/server";
import { requireHubConfig } from "./session";
import { listServerProviderInventory } from "../infrastructure/server-machines";
import { getMachineDiagnostic } from "../plugin/previews/machines-client";

export async function GET(req: NextRequest) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  try {
    const inventory = await listServerProviderInventory(auth.cfg);
    const history = (await Promise.all(inventory.machines.map(async (machine) => {
      const diagnostic = await getMachineDiagnostic(machine.app, machine.machineId, auth.cfg)
        .catch(() => null);
      return (diagnostic?.events ?? []).map((event) => ({
        app: machine.app,
        machineId: machine.machineId,
        label: machine.label,
        state: event.status,
        type: event.type,
        source: event.source,
        timestamp: event.timestamp,
      }));
    }))).flat().sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json(
      { history, now: Date.now() },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch {
    return NextResponse.json({ error: "Could not load Fly history." }, { status: 502 });
  }
}
