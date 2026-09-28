import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireHubConfig, sameOrigin } from "./session";
import { listServerProviderInventory } from "../infrastructure/server-machines";
import { createManagedMachine } from "../machines/managed";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  size: z.enum(["low", "medium", "high"]),
  region: z.string().regex(/^[a-z]{3,4}$/).optional(),
  sleepWhenIdle: z.boolean(),
  requestId: z.uuid(),
});

export async function GET(req: NextRequest) {
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  try {
    const inventory = await listServerProviderInventory(auth.cfg);
    return NextResponse.json(inventory, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch {
    return NextResponse.json({ error: "Could not load Fly machines." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const auth = requireHubConfig(req);
  if ("response" in auth) return auth.response;
  const body = CreateBody.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_machine_settings" }, { status: 400 });
  }
  try {
    const machine = await createManagedMachine({
      ...body.data,
      owner: "flyhub",
      repo: "machines",
      cfg: auth.cfg,
    });
    return NextResponse.json(machine, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Could not create the machine. Check region and Fly capacity." },
      { status: 502 },
    );
  }
}
