import { NextRequest, NextResponse } from "next/server";
import {
  downloadAuthorizedMachineSsh,
  machineSshTargetSchema,
} from "@kody-ade/fly/routes/fly-machines-ssh";
import { resolvePersonalBrainContext } from "../personal-context";
import { readBrainOverview } from "../overview";

/** Personal Brain access is owned by the signed-in Kody account. */
export async function POST(req: NextRequest) {
  const context = await resolvePersonalBrainContext();
  if (!context.ok)
    return NextResponse.json(
      { error: context.error },
      { status: context.status },
    );
  const target = machineSshTargetSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!target.success)
    return NextResponse.json({ error: "Invalid machine" }, { status: 400 });
  const ctx = context.context;
  if (!ctx.flyToken)
    return NextResponse.json(
      { error: "Personal Fly credentials are missing" },
      { status: 503 },
    );
  try {
    const overview = await readBrainOverview({
      flyToken: ctx.flyToken,
      account: ctx.account,
      githubToken: ctx.githubToken,
      orgSlug: ctx.flyOrgSlug,
      defaultRegion: ctx.flyDefaultRegion,
    });
    const machine = overview.service?.machine;
    if (
      !machine ||
      machine.app !== target.data.app ||
      machine.machineId !== target.data.machineId
    ) {
      return NextResponse.json(
        { error: "This Brain does not belong to your account" },
        { status: 403 },
      );
    }
    return downloadAuthorizedMachineSsh({
      ...target.data,
      cfg: {
        token: ctx.flyToken,
        orgSlug: ctx.flyOrgSlug,
        defaultRegion: ctx.flyDefaultRegion,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not download SSH settings" },
      { status: 500 },
    );
  }
}
