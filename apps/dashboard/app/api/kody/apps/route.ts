import "@dashboard/lib/chat/personal-model-settings";
import { NextRequest, NextResponse } from "next/server";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import {
  GET as packageGET,
  POST as packagePOST,
} from "@kody-ade/kody-chat-dashboard/routes/kody/apps";
import { GET as browserStatusGET } from "../browser/session/route";
import { GET as brainStatusGET } from "../brain/status/route";

type AppsResponse = { apps?: unknown[] };
type BrowserStatus = { mode?: string; state?: string };
type BrainStatus = { state?: string; url?: string };

async function responseBody<T extends object>(response: Response): Promise<T> {
  return response
    .clone()
    .json()
    .catch(() => ({}) as T);
}

async function managedApps(req: NextRequest) {
  const now = new Date().toISOString();
  const [browserResponse, brainResponse] = await Promise.all([
    browserStatusGET(req).catch(() => null),
    brainStatusGET(req).catch(() => null),
  ]);
  const browser: BrowserStatus = browserResponse?.ok
    ? await responseBody<BrowserStatus>(browserResponse)
    : {};
  const brain: BrainStatus = brainResponse?.ok
    ? await responseBody<BrainStatus>(brainResponse)
    : {};
  return [
    {
      appId: "managed-browser",
      kind: "browser",
      scope: "repository",
      name: "Browser",
      slug: "browser",
      description: "Interactive browser for this repository",
      observedStatus:
        browser.mode === "iframe"
          ? "fallback"
          : (browser.state ?? "unavailable"),
      desiredStatus: "available",
      manageHref: "/preview",
      provider: {},
      updatedAt: now,
    },
    {
      appId: "managed-brain",
      kind: "brain",
      scope: "personal",
      name: "Brain",
      slug: "brain",
      description: "Your personal Kody runtime",
      observedStatus: brain.state ?? "unavailable",
      desiredStatus: "available",
      manageHref: "/brain",
      lifecycle: {
        start: "/api/kody/brain/resume",
        stop: "/api/kody/brain/suspend",
      },
      provider: { publicUrl: brain.url },
      updatedAt: now,
    },
  ];
}

export async function GET(req: NextRequest) {
  const user = await requireKodyUser();
  if (user instanceof NextResponse) return user;
  const [repositoryResponse, managed] = await Promise.all([
    packageGET(req),
    managedApps(req),
  ]);
  if (!repositoryResponse.ok) return repositoryResponse;
  const body = await responseBody<AppsResponse>(repositoryResponse);
  return NextResponse.json(
    { ...body, apps: [...(body.apps ?? []), ...managed] },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const user = await requireKodyUser();
  return user instanceof NextResponse ? user : packagePOST(req);
}
