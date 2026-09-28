import { NextRequest, NextResponse } from "next/server";
import { requireUserAuth } from "@kody-ade/base/auth";
import { isLocalMachineAccessEnabled } from "@kody-ade/terminal/machine-exec";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireUserAuth(req);
  if (authError instanceof NextResponse) return authError;
  return NextResponse.json(
    { local: isLocalMachineAccessEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
