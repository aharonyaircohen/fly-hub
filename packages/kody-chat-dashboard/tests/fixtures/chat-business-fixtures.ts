/**
 * In-memory fixture backends for the package chat harness.
 *
 * These fixtures mirror the storage calls used by package-owned chat tools
 * without reintroducing removed Agency models.
 */
import type { Octokit } from "@octokit/rest";
import type { Macro } from "../../src/dashboard/lib/macros";
import type { PreviewAction } from "../../src/dashboard/lib/picker/protocol";
import type { InboxManifest } from "../../src/dashboard/lib/inbox/types";
import type {
  NotificationsManifest,
  NotificationRule,
} from "../../src/dashboard/lib/notifications";
import type {
  CompanyBundle,
  CompanyImportCounts,
  CompanyImportMode,
  CompanyImportResult,
  ParsedCompanyBundle,
} from "../../src/dashboard/lib/company/types";
import { COMPANY_BUNDLE_VERSION } from "../../src/dashboard/lib/company/types";

export interface FixtureDashboardConfig {
  version: 1;
  defaultPreviewUrl?: string;
  namedPreviews?: unknown[];
  previewFolders?: Array<{ id: string; label: string }>;
  brainFlyChatEnabled?: boolean;
}

interface FixtureState {
  macros: Macro[];
  inbox: InboxManifest;
  notifications: NotificationsManifest;
  dashboardConfig: FixtureDashboardConfig;
  registeredWebhooks: Array<{ owner: string; repo: string; hookUrl: string }>;
  importedBundles: ParsedCompanyBundle[];
}

function seedState(): FixtureState {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    macros: [
      {
        id: "open-settings",
        name: "Open settings",
        createdAt: Date.parse(now),
        steps: [
          { op: "navigate", url: "/models" } as unknown as PreviewAction,
          { op: "click", selector: "#save" } as unknown as PreviewAction,
        ],
      },
    ],
    inbox: {
      version: 1,
      entries: [
        {
          id: "Issue:1:hello",
          source: "mention",
          repoFullName: "acme/widgets",
          threadType: "Issue",
          title: "Fixture mention",
          snippet: "You were mentioned in a fixture.",
          author: "octocat",
          url: "https://github.com/acme/widgets/issues/1",
          sentAt: now,
          readAt: null,
        },
      ],
    } as InboxManifest,
    notifications: { version: 1, rules: [] } as NotificationsManifest,
    dashboardConfig: { version: 1 },
    registeredWebhooks: [],
    importedBundles: [],
  };
}

let state: FixtureState = seedState();

export function resetChatFixtures(): void {
  state = seedState();
}

export async function readInbox(
  _octokit: Octokit,
  _owner: string,
  _repo: string,
): Promise<{ gistId: string | null; manifest: InboxManifest }> {
  return { gistId: "fixture-gist", manifest: state.inbox };
}

export async function readMacrosFile(
  _octokit?: Octokit,
): Promise<{ macros: Macro[] }> {
  return { macros: state.macros };
}

export async function addMacroToFile(opts: {
  octokit: Octokit;
  name: string;
  steps: PreviewAction[];
}): Promise<Macro> {
  const base =
    opts.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "macro";
  const macro: Macro = {
    id: `${base}-${state.macros.length + 1}`,
    name: opts.name,
    createdAt: Date.now(),
    steps: opts.steps,
  };
  state = { ...state, macros: [macro, ...state.macros] };
  return macro;
}

export async function deleteMacroFromFile(opts: {
  octokit: Octokit;
  id: string;
}): Promise<boolean> {
  const next = state.macros.filter((macro) => macro.id !== opts.id);
  const removed = next.length !== state.macros.length;
  state = { ...state, macros: next };
  return removed;
}

export async function renameMacroInFile(opts: {
  octokit: Octokit;
  id: string;
  name: string;
}): Promise<Macro | null> {
  const existing = state.macros.find((macro) => macro.id === opts.id);
  if (!existing) return null;
  const updated: Macro = { ...existing, name: opts.name };
  state = {
    ...state,
    macros: state.macros.map((macro) =>
      macro.id === opts.id ? updated : macro,
    ),
  };
  return updated;
}

export async function readNotificationsManifestFresh(): Promise<{
  manifest: NotificationsManifest;
}> {
  return { manifest: state.notifications };
}

export async function mutateNotificationsManifest<T>(
  mutator: (manifest: NotificationsManifest) => {
    next: NotificationsManifest;
    result: T;
  },
): Promise<{ result: T; rule?: NotificationRule }> {
  const { next, result } = mutator(state.notifications);
  state = { ...state, notifications: next };
  return { result };
}

export async function ensureWebhook(input: {
  token: string;
  owner: string;
  repo: string;
  hookUrl: string;
  events?: string[];
}): Promise<{ ok: boolean; hookId: number; created: boolean }> {
  state = {
    ...state,
    registeredWebhooks: [
      ...state.registeredWebhooks,
      { owner: input.owner, repo: input.repo, hookUrl: input.hookUrl },
    ],
  };
  return { ok: true, hookId: 1, created: state.registeredWebhooks.length === 1 };
}

export function getRemoteConfig(
  _ghUsername: string,
): { funnelUrl: string; key: string } | null {
  return null;
}

export async function buildCompanyBundle(): Promise<CompanyBundle> {
  return {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: "acme/widgets",
    agent: [{ slug: "kody", title: "Kody", body: "Fixture agent." }],
    contexts: [],
    commands: [],
    capabilities: [],
    instructions: null,
    config: null,
  };
}

export async function applyCompanyBundle(
  _octokit: Octokit,
  bundle: ParsedCompanyBundle,
  mode: CompanyImportMode,
): Promise<CompanyImportResult> {
  state = { ...state, importedBundles: [...state.importedBundles, bundle] };
  const counts = (amount: number): CompanyImportCounts => ({
    created: amount,
    updated: 0,
    skipped: 0,
    failed: 0,
  });
  return {
    mode,
    agent: counts(bundle.agent.length),
    contexts: counts(bundle.contexts.length),
    commands: counts(bundle.commands.length),
    capabilities: counts(bundle.capabilities.length),
    instructions: "absent",
    config: "absent",
    notes: [],
  };
}

export async function readFixtureDashboardConfig(): Promise<FixtureDashboardConfig> {
  return state.dashboardConfig;
}

export async function writeFixtureDashboardConfig(
  next: FixtureDashboardConfig,
): Promise<void> {
  state = { ...state, dashboardConfig: next };
}
