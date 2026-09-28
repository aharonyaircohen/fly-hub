/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern activity-run-logs-api
 * @ai-summary GET /api/kody/activity/run-logs — reads durable run timelines
 *   from the backend without downloading GitHub Actions artifacts.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireKodyAuth, getRequestAuth } from "@kody-ade/base/auth";
import {
  buildRunLogsSnapshot,
  buildRunTimeline,
  type KodyRunLogEvent,
  type KodyRunLogsRun,
} from "@kody-ade/base/activity/run-logs";
import {
  listStoredAgencyRuns,
  listStoredRunEvents,
} from "@kody-ade/agency/agency-runs";

function parseLimit(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.min(25, Math.floor(raw)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

export async function GET(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError instanceof NextResponse) return authError;

  const auth = getRequestAuth(req);
  if (!auth)
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  const runs = await listStoredAgencyRuns(
    auth.owner,
    auth.repo,
    parseLimit(req),
  );
  const runLogs = await mapWithConcurrency(
    runs,
    4,
    async (stored): Promise<KodyRunLogsRun> => {
      const rows = await listStoredRunEvents(
        auth.owner,
        auth.repo,
        stored.runId,
      );
      const events = rows.map((row) =>
        normalizeEvent(row.event, row.runId, row.time),
      );
      const run = asRecord(stored.run);
      const status = stringValue(run.status) ?? "completed";
      const createdAt =
        stringValue(run.startedAt) ??
        stringValue(run.createdAt) ??
        stored.updatedAt;
      return {
        runId: stored.runId,
        runAttempt: 1,
        runNumber: null,
        title:
          stringValue(run.title) ??
          `${stored.subjectType}: ${stored.subjectId}`,
        status,
        conclusion: status === "running" ? null : status,
        createdAt,
        updatedAt: stored.updatedAt,
        htmlUrl: stringValue(asRecord(run.links).actions) ?? "",
        artifactName: "backend-run-events",
        artifactStatus: "available",
        artifactUrl: null,
        message: null,
        events,
        timeline: buildRunTimeline(events),
        agencyBoundaryEvals: [],
      };
    },
  );
  return NextResponse.json(buildRunLogsSnapshot(runLogs));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeEvent(
  value: unknown,
  runId: string,
  time: string,
): KodyRunLogEvent {
  const event = asRecord(value);
  return {
    ts: stringValue(event.time) ?? time,
    runId,
    kind: stringValue(event.kind) ?? stringValue(event.event) ?? "event",
    name: stringValue(event.name) ?? stringValue(event.reason) ?? undefined,
    capability: stringValue(asRecord(event.dispatch).capability) ?? undefined,
    outcome: stringValue(event.status) ?? undefined,
    meta: event,
  };
}
