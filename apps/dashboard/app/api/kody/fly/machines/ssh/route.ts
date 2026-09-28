import "@dashboard/lib/brain/personal-services";
import { NextRequest } from "next/server";
import { POST as downloadRepoMachine } from "@kody-ade/fly/routes/fly-machines-ssh";
import { POST as downloadPersonalBrain } from "@kody-ade/brain/routes/ssh";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const target = await req
    .clone()
    .json()
    .catch(() => null);
  return typeof target?.app === "string" && target.app.startsWith("kody-brain-")
    ? downloadPersonalBrain(req)
    : downloadRepoMachine(req);
}
