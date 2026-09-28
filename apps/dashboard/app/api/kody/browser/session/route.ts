/**
 * @fileType api-endpoint
 * @domain browser
 * @pattern browser-session-route
 * @ai-summary Repository-scoped real-browser lifecycle. Uses the installed
 *   browser provider, Convex runtime state, and the repository's Fly vault.
 */

import { createHash, randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { logger } from "@kody-ade/base/logger";
import {
  getBrowserProvider,
  type FlyBrowserAction,
  type FlyBrowserProvider,
  type FlyBrowserSession,
  type CreateFlyBrowserSessionInput,
  ensureBrowserSessionReady,
  browserAppName,
  getBrowserMachineDiagnostic,
} from "@kody-ade/fly/infrastructure/browser";
import {
  resolveServerProviderContext,
  serverProviderConfigFromContext,
} from "@kody-ade/fly/infrastructure/server-context";
import {
  deriveBrowserKey,
  mintBrowserTicket,
  type BrowserTicketIdentity,
} from "@kody-ade/fly/browsers/ticket";
import { validatePublicBrowserUrl } from "@kody-ade/fly/browsers/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 4 * 60 * 60 * 1_000;
const STREAM_TICKET_TTL_SECONDS = 5 * 60;
const DIRECT_BROWSER_TICKET_TTL_SECONDS = 60 * 60;
const DEFAULT_BROWSER_IMAGE =
  process.env.FLY_BROWSER_IMAGE ??
  "ghcr.io/aharonyaircohen/kody-browser:latest";
const START_LEASE_MS = 75_000;

const CapabilityBrowserScope = {
  capabilitySlug: z.string().min(1).max(120).optional(),
  allowedOrigins: z.array(z.string().url().max(2_048)).max(20).optional(),
};

const BrowserAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("navigate"),
    url: z.string().url().max(4_096),
    ...CapabilityBrowserScope,
  }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("forward") }),
  z.object({ type: z.literal("reload") }),
  z.object({
    type: z.literal("viewport"),
    width: z.number().int().min(320).max(1_920),
    height: z.number().int().min(480).max(1_800),
  }),
  z.object({ type: z.literal("screenshot") }),
  z.object({ type: z.literal("snapshot") }),
  z.object({ type: z.literal("pick") }),
  z.object({ type: z.literal("pickResult") }),
  z.object({ type: z.literal("cancelPick") }),
  z.object({ type: z.literal("perf") }),
  z.object({
    type: z.literal("edit"),
    command: z.object({
      selector: z.string().min(1).max(2_000),
      mutation: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({ type: z.literal("undoEdit") }),
  z.object({
    type: z.literal("resetEdits"),
    selector: z.string().max(2_000).optional(),
  }),
  z.object({ type: z.literal("recordStart") }),
  z.object({ type: z.literal("recordStop") }),
  z.object({
    type: z.literal("pointer"),
    action: z.enum(["move", "down", "up", "wheel"]),
    x: z.number().finite(),
    y: z.number().finite(),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite().optional(),
    button: z.enum(["left", "middle", "right"]).optional(),
  }),
  z.object({
    type: z.literal("keyboard"),
    action: z.enum(["down", "up", "insertText"]),
    key: z.string().max(4_096),
  }),
  z.object({
    type: z.literal("click"),
    selector: z.string().min(1).max(2_000),
    ...CapabilityBrowserScope,
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().min(1).max(2_000),
    value: z.string().max(20_000),
    ...CapabilityBrowserScope,
  }),
  z.object({
    type: z.literal("upload"),
    selector: z.string().min(1).max(2_000),
    uploadId: z.string().uuid(),
    capabilitySlug: z.string().min(1).max(120),
    allowedOrigins: z.array(z.string().url().max(2_048)).min(1).max(20),
  }),
  z.object({
    type: z.literal("scroll"),
    selector: z.string().max(2_000).optional(),
    deltaY: z.number().finite(),
    ...CapabilityBrowserScope,
  }),
  z.object({
    type: z.literal("wait"),
    ms: z.number().int().min(0).max(10_000),
    ...CapabilityBrowserScope,
  }),
]);

const Body = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("start"),
    actorLogin: z.string().min(1).max(100).optional(),
    initialUrl: z.string().url().max(4_096),
  }),
  z.object({
    operation: z.literal("act"),
    actorLogin: z.string().min(1).max(100).optional(),
    sessionId: z.string().min(1).max(160),
    action: BrowserAction,
  }),
  z.object({
    operation: z.literal("resume"),
    actorLogin: z.string().min(1).max(100).optional(),
    sessionId: z.string().min(1).max(160),
  }),
  z.object({
    operation: z.literal("close"),
    actorLogin: z.string().min(1).max(100).optional(),
    sessionId: z.string().min(1).max(160),
  }),
  z.object({
    operation: z.literal("diagnose"),
    actorLogin: z.string().min(1).max(100).optional(),
    sessionId: z.string().min(1).max(160),
  }),
]);

type StoredBrowserSession = {
  sessionId: string;
  providerId: string;
  appName: string;
  machineId: string;
  state: "starting" | "running" | "suspended" | "failed";
  currentUrl: string;
  viewport: { width: number; height: number };
  expiresAtMs: number;
};

function stableSessionId(owner: string, repo: string, actorId: string): string {
  const hash = createHash("sha256")
    .update(`${owner}/${repo}:${actorId}`)
    .digest("hex")
    .slice(0, 24);
  return `browser-${hash}`;
}

function ticketIdentity(
  owner: string,
  repo: string,
  actorId: string,
  session: Pick<StoredBrowserSession, "sessionId" | "machineId">,
): BrowserTicketIdentity {
  return {
    repository: `${owner}/${repo}`,
    actorId,
    sessionId: session.sessionId,
    machineId: session.machineId,
  };
}

function clientSession(
  owner: string,
  repo: string,
  actorId: string,
  session: StoredBrowserSession,
) {
  const identity = ticketIdentity(owner, repo, actorId, session);
  const { ticket, expiresAt } = mintBrowserTicket(
    identity,
    STREAM_TICKET_TTL_SECONDS,
  );
  const { ticket: directTicket } = mintBrowserTicket(
    identity,
    DIRECT_BROWSER_TICKET_TTL_SECONDS,
  );
  return {
    mode: "remote" as const,
    sessionId: session.sessionId,
    state: session.state,
    currentUrl: session.currentUrl,
    viewport: session.viewport,
    streamUrl: `wss://${session.appName}.fly.dev/stream?ticket=${encodeURIComponent(ticket)}`,
    directUrl: `https://${session.appName}.fly.dev/direct?ticket=${encodeURIComponent(directTicket)}`,
    uploadUrl: `https://${session.appName}.fly.dev/upload?ticket=${encodeURIComponent(ticket)}`,
    ticketExpiresAt: expiresAt,
  };
}

async function requestAuthority(req: NextRequest, actorLogin?: string) {
  const verified = await verifyActorLogin(req, actorLogin);
  if (verified instanceof NextResponse) return verified;
  const resolved = await resolveServerProviderContext(req);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }
  const config = serverProviderConfigFromContext(resolved.context);
  return {
    actorId: verified.identity.login,
    owner: resolved.context.owner,
    repo: resolved.context.repo,
    config,
  };
}

export async function GET(req: NextRequest) {
  const authError = await verifyRepoReadAccess(req);
  if (authError instanceof NextResponse) return authError;
  const authority = await requestAuthority(
    req,
    req.nextUrl.searchParams.get("actorLogin") ?? undefined,
  );
  if (authority instanceof NextResponse) return authority;
  if (!authority.config) {
    return NextResponse.json({ mode: "iframe", reason: "fly_not_configured" });
  }
  const session = (await createBackendClient().query(
    backendApi.browserSessions.getActive,
    {
      tenantId: `${authority.owner}/${authority.repo}`,
      actorId: authority.actorId,
      nowMs: Date.now(),
    },
  )) as StoredBrowserSession | null;
  if (!session) return NextResponse.json({ mode: "remote", state: "idle" });
  if (req.nextUrl.searchParams.get("diagnose") === "1") {
    const diagnostic = await getBrowserMachineDiagnostic(
      session.appName,
      session.machineId,
      authority.config,
    );
    return NextResponse.json(
      diagnostic ?? { error: "browser_machine_not_found" },
      { status: diagnostic ? 200 : 404 },
    );
  }
  return NextResponse.json(
    clientSession(authority.owner, authority.repo, authority.actorId, session),
  );
}

export async function POST(req: NextRequest) {
  const authError = await verifyRepoWriteAccess(req);
  if (authError instanceof NextResponse) return authError;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const authority = await requestAuthority(req, data.actorLogin);
  if (authority instanceof NextResponse) return authority;
  if (!authority.config) {
    return NextResponse.json({ mode: "iframe", reason: "fly_not_configured" });
  }
  const config = authority.config;
  const backend = createBackendClient();
  const tenantId = `${authority.owner}/${authority.repo}`;
  const provider = getBrowserProvider() as FlyBrowserProvider;

  try {
    if (data.operation === "start") {
      const startData = data;
      const leaseOwnerId = randomUUID();
      const leaseNowMs = Date.now();
      const acquired = await backend.mutation(
        backendApi.browserSessions.acquireStartLease,
        {
          tenantId,
          actorId: authority.actorId,
          ownerId: leaseOwnerId,
          nowMs: leaseNowMs,
          leaseUntilMs: leaseNowMs + START_LEASE_MS,
        },
      );
      if (!acquired) {
        return NextResponse.json(
          { error: "browser_start_in_progress", retryAfterMs: 1_000 },
          { status: 409 },
        );
      }
      try {
        const initialUrl = await validatePublicBrowserUrl(startData.initialUrl);
        const nowMs = Date.now();
        let previous = (await backend.query(
          backendApi.browserSessions.getActive,
          {
            tenantId,
            actorId: authority.actorId,
            nowMs,
          },
        )) as StoredBrowserSession | null;
        const expectedAppName = browserAppName({
          owner: authority.owner,
          repo: authority.repo,
          actorId: authority.actorId,
        });
        if (previous && previous.appName !== expectedAppName) {
          try {
            await provider.closeSession({
              providerId: "fly",
              sessionId: previous.sessionId,
              appName: previous.appName,
              machineId: previous.machineId,
              state: previous.state,
              region: config.defaultRegion,
              endpoint: `https://${previous.appName}.fly.dev`,
              config,
            });
          } catch (error) {
            logger.warn(
              { err: error, appName: previous.appName },
              "browser-session: obsolete Machine cleanup failed",
            );
          }
          await backend.mutation(backendApi.browserSessions.close, {
            tenantId,
            actorId: authority.actorId,
            sessionId: previous.sessionId,
            nowMs,
          });
          previous = null;
        }
        if (previous) {
          try {
            const reconciled = await provider.createSession({
              owner: authority.owner,
              repo: authority.repo,
              actorId: authority.actorId,
              sessionId: previous.sessionId,
              initialUrl,
              image: DEFAULT_BROWSER_IMAGE,
              config,
              verifyKey: deriveBrowserKey().toString("base64url"),
            } satisfies CreateFlyBrowserSessionInput);
            await ensureBrowserSessionReady(reconciled);
            const { ticket } = mintBrowserTicket(
              ticketIdentity(
                authority.owner,
                authority.repo,
                authority.actorId,
                reconciled,
              ),
              STREAM_TICKET_TTL_SECONDS,
            );
            const navigation = await provider.act(
              { ...reconciled, accessTicket: ticket },
              { type: "navigate", url: initialUrl },
            );
            if (!navigation.ok) throw new Error("browser_navigation_failed");
            const currentUrl = navigation.url ?? initialUrl;
            const readySession: StoredBrowserSession = {
              sessionId: previous.sessionId,
              providerId: reconciled.providerId,
              appName: reconciled.appName,
              machineId: reconciled.machineId,
              state: "running",
              currentUrl,
              viewport: previous.viewport,
              expiresAtMs: nowMs + SESSION_TTL_MS,
            };
            await backend.mutation(backendApi.browserSessions.save, {
              tenantId,
              actorId: authority.actorId,
              ...readySession,
              nowMs,
            });
            return NextResponse.json(
              clientSession(
                authority.owner,
                authority.repo,
                authority.actorId,
                readySession,
              ),
            );
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "browser_machine_not_found"
            ) {
              throw error;
            }
            await backend.mutation(backendApi.browserSessions.close, {
              tenantId,
              actorId: authority.actorId,
              sessionId: previous.sessionId,
              nowMs,
            });
          }
        }
        const sessionId = stableSessionId(
          authority.owner,
          authority.repo,
          authority.actorId,
        );
        const session = await provider.createSession({
          owner: authority.owner,
          repo: authority.repo,
          actorId: authority.actorId,
          sessionId,
          initialUrl,
          image: DEFAULT_BROWSER_IMAGE,
          config,
          verifyKey: deriveBrowserKey().toString("base64url"),
        } satisfies CreateFlyBrowserSessionInput);
        await ensureBrowserSessionReady(session);
        const stored: StoredBrowserSession = {
          sessionId,
          providerId: session.providerId,
          appName: session.appName,
          machineId: session.machineId,
          state: "running",
          currentUrl: initialUrl,
          viewport: { width: 1_280, height: 720 },
          expiresAtMs: nowMs + SESSION_TTL_MS,
        };
        await backend.mutation(backendApi.browserSessions.save, {
          tenantId,
          actorId: authority.actorId,
          ...stored,
          nowMs,
        });
        return NextResponse.json(
          clientSession(
            authority.owner,
            authority.repo,
            authority.actorId,
            stored,
          ),
        );
      } finally {
        await backend
          .mutation(backendApi.browserSessions.releaseStartLease, {
            tenantId,
            actorId: authority.actorId,
            ownerId: leaseOwnerId,
          })
          .catch((error) =>
            logger.warn(
              { err: error },
              "browser-session: start lease will expire naturally",
            ),
          );
      }
    }

    const stored = (await backend.query(backendApi.browserSessions.get, {
      tenantId,
      actorId: authority.actorId,
      sessionId: data.sessionId,
    })) as StoredBrowserSession | null;
    if (!stored) {
      return NextResponse.json(
        { error: "browser_session_not_found" },
        { status: 404 },
      );
    }
    const providerSession: FlyBrowserSession = {
      providerId: "fly",
      sessionId: stored.sessionId,
      appName: stored.appName,
      machineId: stored.machineId,
      state: stored.state,
      region: config.defaultRegion,
      endpoint: `https://${stored.appName}.fly.dev`,
      config,
    };

    if (data.operation === "resume") {
      await ensureBrowserSessionReady(providerSession);
      const nowMs = Date.now();
      const resumed: StoredBrowserSession = {
        ...stored,
        state: "running",
        expiresAtMs: nowMs + SESSION_TTL_MS,
      };
      await backend.mutation(backendApi.browserSessions.touch, {
        tenantId,
        actorId: authority.actorId,
        sessionId: stored.sessionId,
        nowMs,
        expiresAtMs: resumed.expiresAtMs,
        state: "running",
      });
      return NextResponse.json(
        clientSession(
          authority.owner,
          authority.repo,
          authority.actorId,
          resumed,
        ),
      );
    }

    if (data.operation === "close") {
      await provider.closeSession(providerSession);
      await backend.mutation(backendApi.browserSessions.close, {
        tenantId,
        actorId: authority.actorId,
        sessionId: stored.sessionId,
        nowMs: Date.now(),
      });
      return NextResponse.json({ ok: true });
    }

    if (data.operation === "diagnose") {
      const diagnostic = await getBrowserMachineDiagnostic(
        stored.appName,
        stored.machineId,
        config,
      );
      return NextResponse.json(
        diagnostic ?? { error: "browser_machine_not_found" },
        { status: diagnostic ? 200 : 404 },
      );
    }

    if (data.action.type === "navigate") {
      await validatePublicBrowserUrl(data.action.url);
    }
    await ensureBrowserSessionReady(providerSession);
    const { ticket } = mintBrowserTicket(
      ticketIdentity(
        authority.owner,
        authority.repo,
        authority.actorId,
        stored,
      ),
      STREAM_TICKET_TTL_SECONDS,
    );
    const result = await provider.act(
      { ...providerSession, accessTicket: ticket },
      data.action as FlyBrowserAction,
    );
    const nowMs = Date.now();
    await backend.mutation(backendApi.browserSessions.touch, {
      tenantId,
      actorId: authority.actorId,
      sessionId: stored.sessionId,
      nowMs,
      expiresAtMs: nowMs + SESSION_TTL_MS,
      ...(result.url ? { currentUrl: result.url } : {}),
      ...(data.action.type === "viewport"
        ? {
            viewport: {
              width: data.action.width,
              height: data.action.height,
            },
          }
        : {}),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    logger.error(
      { err: error, operation: data.operation },
      "browser-session: operation failed",
    );
    const code =
      error instanceof Error ? error.message : "browser_operation_failed";
    return NextResponse.json(
      {
        error:
          code === "browser_url_blocked" ? code : "browser_operation_failed",
      },
      { status: code === "browser_url_blocked" ? 400 : 500 },
    );
  }
}
