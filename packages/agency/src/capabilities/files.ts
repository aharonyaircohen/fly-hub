/**
 * A Capability is one small folder:
 * instructions.md, optional contract.json, skills/, and tools/.
 *
 * Local folders are stored as one Convex document. Store folders are read
 * directly from the configured Company Store.
 */
import type { Octokit } from "@octokit/rest";

import {
  buildCompanyStoreHtmlUrl,
  companyStoreAssetPath,
  listCompanyStoreAssetSlugs,
  listCompanyStoreDirectorySafe,
  mergeAssetsBySlug,
  readCompanyStoreText,
} from "@kody-ade/base/company-store/assets";
import { getOctokit, getOwner, getRepo } from "@kody-ade/base/github/core";
import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  definitionVersion,
  type DefinitionBundle,
} from "@kody-ade/backend/definition-bundle";

const INSTRUCTIONS_FILE = "instructions.md";
const CONTRACT_FILE = "contract.json";
const KIND_PREFIX = "capability:";
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface CapabilitySkill {
  name: string;
  body: string;
}

export interface CapabilityTool {
  name: string;
  content: string;
}

export type CapabilityExecution = "agent" | "script";

export const USER_BROWSER_ACTIONS = [
  "navigate",
  "click",
  "fill",
  "upload",
  "scroll",
  "wait",
] as const;

export type UserBrowserAction = (typeof USER_BROWSER_ACTIONS)[number];

export interface CapabilityRuntimeRequirements {
  cms?: boolean;
  browser?: boolean;
  qaCredentials?: boolean;
  githubTestToken?: boolean;
  qaAccountCredentials?: string[];
  qaAccountModelSettings?: Record<string, unknown>;
  browserOnly?: boolean;
  browserSession?: "user";
  browserActions?: UserBrowserAction[];
  browserOrigins?: string[];
  browserFileRoots?: string[];
}

export interface UserBrowserGrant {
  actions: UserBrowserAction[];
  origins: string[];
  fileRoots: string[];
}

export interface CapabilitySummary {
  slug: string;
  describe: string;
  updatedAt: string | null;
  htmlUrl: string;
  source: "local" | "store";
  readOnly: boolean;
}

export interface CapabilityDetail extends CapabilitySummary {
  execution: CapabilityExecution;
  instructions: string;
  contract: string | null;
  skills: CapabilitySkill[];
  capabilityTools: CapabilityTool[];
}

export interface WriteCapabilityFolderFilesOptions {
  slug: string;
  files: Record<string, string>;
  isUpdate?: boolean;
}

interface RepoDoc {
  kind: string;
  doc: unknown;
  updatedAt: string;
}

interface CapabilityDefinition {
  slug: string;
  bundle: DefinitionBundle;
  updatedAt: string;
}

function tenantId(): string {
  return `${getOwner()}/${getRepo()}`;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseStoredFiles(value: unknown): Record<string, string> | null {
  const doc = asRecord(value);
  const rawFiles = asRecord(doc?.files);
  if (!rawFiles) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(rawFiles)) {
    if (typeof content !== "string") return null;
    files[path] = content;
  }
  return files;
}

function description(instructions: string, slug: string): string {
  const line = instructions
    .split(/\r?\n/)
    .map((value) => value.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return line ?? `Run ${slug.replaceAll("-", " ")}`;
}

function detailFromFiles(
  slug: string,
  files: Record<string, string>,
  options: {
    updatedAt: string | null;
    htmlUrl: string;
    source: "local" | "store";
    readOnly: boolean;
  },
): CapabilityDetail {
  assertSimpleCapabilityFolder(files);
  const instructions = files[INSTRUCTIONS_FILE]!;
  const contract = files[CONTRACT_FILE]
    ? parseCapabilityContract(files[CONTRACT_FILE])
    : null;
  return {
    slug,
    describe: description(instructions, slug),
    ...options,
    execution: contract?.execution ?? "agent",
    instructions,
    contract: files[CONTRACT_FILE] ?? null,
    skills: Object.entries(files)
      .flatMap(([path, body]) =>
        path.startsWith("skills/") && path !== "skills/.gitkeep"
          ? [{ name: path.slice("skills/".length), body }]
          : [],
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
    capabilityTools: Object.entries(files)
      .flatMap(([path, content]) =>
        path.startsWith("tools/") && path !== "tools/.gitkeep"
          ? [{ name: path.slice("tools/".length), content }]
          : [],
      )
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function summary(detail: CapabilityDetail): CapabilitySummary {
  const { slug, describe, updatedAt, htmlUrl, source, readOnly } = detail;
  return { slug, describe, updatedAt, htmlUrl, source, readOnly };
}

export async function listLocalCapabilityFiles(): Promise<CapabilitySummary[]> {
  const backend = createBackendClient();
  const [definitions, legacyRows] = await Promise.all([
    backend.query(api.definitions.listCurrent, {
      tenantId: tenantId(),
      kind: "capability",
    }) as Promise<CapabilityDefinition[]>,
    backend.query(api.repoDocs.listByPrefix, {
      tenantId: tenantId(),
      prefix: KIND_PREFIX,
    }) as Promise<RepoDoc[]>,
  ]);
  const definitionRows = definitions.map((definition) => ({
    kind: `${KIND_PREFIX}${definition.slug}`,
    doc: { files: definition.bundle.files },
    updatedAt: definition.updatedAt,
  }));
  const definitionSlugs = new Set(definitions.map(({ slug }) => slug));
  return [
    ...definitionRows,
    ...legacyRows.filter(
      (row) => !definitionSlugs.has(row.kind.slice(KIND_PREFIX.length)),
    ),
  ]
    .flatMap((row) => {
      const slug = row.kind.slice(KIND_PREFIX.length);
      const files = parseStoredFiles(row.doc);
      if (!isValidSlug(slug) || !files) return [];
      try {
        return [
          summary(
            detailFromFiles(slug, files, {
              updatedAt: row.updatedAt,
              htmlUrl: "",
              source: "local",
              readOnly: false,
            }),
          ),
        ];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function listCapabilityFiles(
  options: { activeStoreSlugs?: Set<string> } = {},
): Promise<CapabilitySummary[]> {
  const octokit = getOctokit();
  const local = await listLocalCapabilityFiles();
  const store = await listStoreCapabilityFiles(
    octokit,
    new Set(local.map((item) => item.slug)),
    options.activeStoreSlugs,
  );
  return mergeAssetsBySlug(local, store);
}

export async function listStoreCapabilityFiles(
  octokit: Octokit,
  localSlugs: Set<string> = new Set(),
  activeStoreSlugs?: Set<string>,
): Promise<CapabilitySummary[]> {
  const slugs = await listCompanyStoreAssetSlugs(
    octokit,
    "capabilities",
    isValidSlug,
  );
  return slugs
    .filter((slug) => !localSlugs.has(slug))
    .filter((slug) => !activeStoreSlugs || activeStoreSlugs.has(slug))
    .map((slug) => ({
      slug,
      describe: `Run ${slug.replaceAll("-", " ")}`,
      updatedAt: null,
      htmlUrl: buildCompanyStoreHtmlUrl("capabilities", slug),
      source: "store" as const,
      readOnly: true,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

export async function readCapabilityFile(
  slug: string,
  _octokit?: Octokit,
  options: { tenantId?: string } = {},
): Promise<CapabilityDetail | null> {
  if (!isValidSlug(slug)) return null;
  const backend = createBackendClient();
  const definition = (await backend.query(api.definitions.getCurrent, {
    tenantId: options.tenantId ?? tenantId(),
    kind: "capability",
    slug,
  })) as CapabilityDefinition | null;
  const row = definition
    ? {
        kind: `${KIND_PREFIX}${slug}`,
        doc: { files: definition.bundle.files },
        updatedAt: definition.updatedAt,
      }
    : ((await backend.query(api.repoDocs.get, {
        tenantId: options.tenantId ?? tenantId(),
        kind: `${KIND_PREFIX}${slug}`,
      })) as RepoDoc | null);
  const files = row ? parseStoredFiles(row.doc) : null;
  return files
    ? detailFromFiles(slug, files, {
        updatedAt: row!.updatedAt,
        htmlUrl: "",
        source: "local",
        readOnly: false,
      })
    : null;
}

export async function readResolvedCapabilityFile(
  slug: string,
  octokit?: Octokit,
  options: {
    activeStoreSlugs?: ReadonlySet<string>;
    tenantId?: string;
  } = {},
): Promise<CapabilityDetail | null> {
  const local = await readCapabilityFile(slug, undefined, options);
  if (local) return local;
  if (options.activeStoreSlugs && !options.activeStoreSlugs.has(slug)) {
    return null;
  }
  return readStoreCapabilityFile(slug, octokit ?? getOctokit());
}

/**
 * Resolve every capability referenced by a Workflow against the same sources
 * the Dashboard exposes: local backend definitions and explicitly active Store
 * capabilities. This prevents a slug-only allowlist from passing a workflow
 * that Engine cannot hydrate at run time.
 */
export async function findMissingCapabilitySlugs(
  slugs: readonly string[],
  options: {
    octokit?: Octokit;
    activeStoreSlugs?: ReadonlySet<string>;
    builtInSlugs?: ReadonlySet<string>;
    tenantId?: string;
  } = {},
): Promise<string[]> {
  const unique = [...new Set(slugs)].filter(
    (slug) => !options.builtInSlugs?.has(slug),
  );
  const resolved = await Promise.all(
    unique.map(async (slug) =>
      Boolean(await readResolvedCapabilityFile(slug, options.octokit, options)),
    ),
  );
  return unique.filter((_, index) => !resolved[index]);
}

export async function readCapabilityFolderFiles(
  slug: string,
  _octokit?: Octokit,
): Promise<Record<string, string> | null> {
  if (!isValidSlug(slug)) return null;
  const row = (await createBackendClient().query(api.repoDocs.get, {
    tenantId: tenantId(),
    kind: `${KIND_PREFIX}${slug}`,
  })) as RepoDoc | null;
  return row ? parseStoredFiles(row.doc) : null;
}

async function readStoreFolder(
  octokit: Octokit,
  absolutePath: string,
  relativePath: string,
  files: Record<string, string>,
): Promise<void> {
  const entries = await listCompanyStoreDirectorySafe(octokit, absolutePath);
  for (const entry of entries) {
    const absolute = `${absolutePath}/${entry.name}`;
    const relative = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (entry.type === "dir") {
      await readStoreFolder(octokit, absolute, relative, files);
    } else if (entry.type === "file") {
      const content = await readCompanyStoreText(octokit, absolute);
      if (content !== null) files[relative] = content;
    }
  }
}

export async function readCompanyStoreCapabilityFolderFiles(
  slug: string,
  octokit: Octokit,
): Promise<Record<string, string> | null> {
  if (!isValidSlug(slug)) return null;
  const root = await companyStoreAssetPath(octokit, "capabilities", slug);
  const files: Record<string, string> = {};
  await readStoreFolder(octokit, root, "", files);
  try {
    assertSimpleCapabilityFolder(files);
    return files;
  } catch {
    return null;
  }
}

async function readStoreCapabilityFile(
  slug: string,
  octokit: Octokit,
): Promise<CapabilityDetail | null> {
  const files = await readCompanyStoreCapabilityFolderFiles(slug, octokit);
  if (!files) return null;
  return detailFromFiles(slug, files, {
    updatedAt: null,
    htmlUrl: buildCompanyStoreHtmlUrl("capabilities", slug),
    source: "store",
    readOnly: true,
  });
}

function assertSafePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid capability file path: "${path}"`);
  }
}

export function assertSimpleCapabilityFolder(
  files: Readonly<Record<string, string>>,
): void {
  for (const path of Object.keys(files)) {
    assertSafePath(path);
    if (
      path !== INSTRUCTIONS_FILE &&
      path !== CONTRACT_FILE &&
      !path.startsWith("skills/") &&
      !path.startsWith("tools/")
    ) {
      throw new Error(
        `Capability folder only allows instructions.md, contract.json, skills/, and tools/; found ${path}`,
      );
    }
  }
  if (typeof files[INSTRUCTIONS_FILE] !== "string") {
    throw new Error("Capability folder requires instructions.md");
  }
  const contract = files[CONTRACT_FILE];
  if (contract !== undefined) {
    const parsed = parseCapabilityContract(contract);
    if (
      parsed.execution === "script" &&
      (typeof files["tools/run.sh"] !== "string" ||
        !files["tools/run.sh"].trim())
    ) {
      throw new Error(
        'Script-backed Capability requires a non-empty "tools/run.sh" file',
      );
    }
  }
}

function parseCapabilityContract(raw: string): {
  execution?: CapabilityExecution;
  deliveryPolicy?: "checkpoint";
  deliveryPathAllowlist?: string[];
  deliveryConfigAllowlist?: Record<string, string[]>;
  requirements?: CapabilityRuntimeRequirements;
  connections?: string[];
  secrets?: string[];
  timeoutMs?: number;
  requiredSubagents?: string[];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("contract.json must be valid JSON");
  }
  const value = asRecord(parsed);
  if (!value || !asRecord(value.input) || !asRecord(value.output)) {
    throw new Error("contract.json must contain input and output JSON schemas");
  }
  if (
    value.execution !== undefined &&
    value.execution !== "agent" &&
    value.execution !== "script"
  ) {
    throw new Error('contract.json execution must be "agent" or "script"');
  }
  if (
    value.deliveryPolicy !== undefined &&
    value.deliveryPolicy !== "checkpoint"
  ) {
    throw new Error('contract.json deliveryPolicy must be "checkpoint"');
  }
  if (value.deliveryPolicy === "checkpoint" && value.execution !== "agent") {
    throw new Error(
      'contract.json deliveryPolicy is supported only when execution is "agent"',
    );
  }
  const requirementsValue =
    value.requirements === undefined ? undefined : asRecord(value.requirements);
  if (value.requirements !== undefined && !requirementsValue) {
    throw new Error("contract.json requirements must be an object");
  }
  const requirementKeys = Object.keys(requirementsValue ?? {});
  const unsupportedRequirements = requirementKeys.filter(
    (key) =>
      key !== "cms" &&
      key !== "browser" &&
      key !== "qaCredentials" &&
      key !== "githubTestToken" &&
      key !== "qaAccountCredentials" &&
      key !== "qaAccountModelSettings" &&
      key !== "browserOnly" &&
      key !== "browserSession" &&
      key !== "browserActions" &&
      key !== "browserOrigins" &&
      key !== "browserFileRoots",
  );
  if (unsupportedRequirements.length > 0) {
    throw new Error(
      `contract.json requirements contains unsupported fields: ${unsupportedRequirements.join(", ")}`,
    );
  }
  if (
    requirementsValue?.cms !== undefined &&
    typeof requirementsValue.cms !== "boolean"
  ) {
    throw new Error("contract.json requirements.cms must be boolean");
  }
  if (
    requirementsValue?.browser !== undefined &&
    typeof requirementsValue.browser !== "boolean"
  ) {
    throw new Error("contract.json requirements.browser must be boolean");
  }
  if (
    requirementsValue?.qaCredentials !== undefined &&
    typeof requirementsValue.qaCredentials !== "boolean"
  ) {
    throw new Error("contract.json requirements.qaCredentials must be boolean");
  }
  if (
    requirementsValue?.githubTestToken !== undefined &&
    typeof requirementsValue.githubTestToken !== "boolean"
  ) {
    throw new Error(
      "contract.json requirements.githubTestToken must be boolean",
    );
  }
  if (
    requirementsValue?.qaAccountCredentials !== undefined &&
    (!Array.isArray(requirementsValue.qaAccountCredentials) ||
      requirementsValue.qaAccountCredentials.length === 0 ||
      !requirementsValue.qaAccountCredentials.every(
        (name) =>
          typeof name === "string" && /^[A-Z][A-Z0-9_]{0,127}$/.test(name),
      ))
  ) {
    throw new Error(
      "contract.json requirements.qaAccountCredentials must contain valid credential names",
    );
  }
  if (
    requirementsValue?.qaAccountModelSettings !== undefined &&
    !asRecord(requirementsValue.qaAccountModelSettings)
  ) {
    throw new Error(
      "contract.json requirements.qaAccountModelSettings must be an object",
    );
  }
  if (
    requirementsValue?.browserOnly !== undefined &&
    typeof requirementsValue.browserOnly !== "boolean"
  ) {
    throw new Error("contract.json requirements.browserOnly must be boolean");
  }
  if (
    requirementsValue?.browserSession !== undefined &&
    requirementsValue.browserSession !== "user"
  ) {
    throw new Error('contract.json requirements.browserSession must be "user"');
  }
  const browserActions = parseUserBrowserActions(
    requirementsValue?.browserActions,
  );
  const browserOrigins = parseUserBrowserOrigins(
    requirementsValue?.browserOrigins,
  );
  const browserFileRoots = parseUserBrowserFileRoots(
    requirementsValue?.browserFileRoots,
  );
  if (
    (requirementsValue?.qaCredentials === true ||
      requirementsValue?.githubTestToken === true ||
      requirementsValue?.qaAccountCredentials !== undefined ||
      requirementsValue?.qaAccountModelSettings !== undefined ||
      requirementsValue?.browserOnly === true ||
      requirementsValue?.browserSession === "user") &&
    requirementsValue.browser !== true
  ) {
    throw new Error(
      "contract.json protected browser requirement requires browser",
    );
  }
  if (requirementsValue?.browserSession === "user") {
    if (value.execution !== "agent") {
      throw new Error(
        'contract.json requirements.browserSession "user" is supported only when execution is "agent"',
      );
    }
    if (!browserActions?.length) {
      throw new Error(
        "contract.json user browser requirements need browserActions",
      );
    }
    if (!browserOrigins?.length) {
      throw new Error(
        "contract.json user browser requirements need browserOrigins",
      );
    }
    if (browserActions.includes("upload") && !browserFileRoots?.length) {
      throw new Error("contract.json browser upload requires browserFileRoots");
    }
  } else if (
    browserActions !== undefined ||
    browserOrigins !== undefined ||
    browserFileRoots !== undefined
  ) {
    throw new Error(
      'contract.json browserActions, browserOrigins, and browserFileRoots require browserSession "user"',
    );
  }
  const requirements = requirementsValue
    ? {
        ...(requirementsValue.cms === true ? { cms: true } : {}),
        ...(requirementsValue.browser === true ? { browser: true } : {}),
        ...(requirementsValue.qaCredentials === true
          ? { qaCredentials: true }
          : {}),
        ...(requirementsValue.githubTestToken === true
          ? { githubTestToken: true }
          : {}),
        ...(Array.isArray(requirementsValue.qaAccountCredentials)
          ? {
              qaAccountCredentials: [
                ...new Set(requirementsValue.qaAccountCredentials as string[]),
              ],
            }
          : {}),
        ...(asRecord(requirementsValue.qaAccountModelSettings)
          ? {
              qaAccountModelSettings: asRecord(
                requirementsValue.qaAccountModelSettings,
              )!,
            }
          : {}),
        ...(requirementsValue.browserOnly === true
          ? { browserOnly: true }
          : {}),
        ...(requirementsValue.browserSession === "user"
          ? { browserSession: "user" as const }
          : {}),
        ...(browserActions ? { browserActions } : {}),
        ...(browserOrigins ? { browserOrigins } : {}),
        ...(browserFileRoots ? { browserFileRoots } : {}),
      }
    : undefined;
  const secrets =
    value.secrets === undefined
      ? undefined
      : Array.isArray(value.secrets) &&
          value.secrets.every(
            (name) =>
              typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name),
          )
        ? [...new Set(value.secrets as string[])]
        : null;
  if (secrets === null) {
    throw new Error(
      "contract.json secrets must contain valid environment variable names",
    );
  }
  if (secrets && value.execution !== "script") {
    throw new Error(
      'contract.json secrets are supported only when execution is "script"',
    );
  }
  const connections =
    value.connections === undefined
      ? undefined
      : Array.isArray(value.connections) &&
          value.connections.length > 0 &&
          value.connections.every(
            (id) =>
              typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id),
          )
        ? [...new Set(value.connections as string[])]
        : null;
  if (connections === null) {
    throw new Error(
      "contract.json connections must contain valid Connection ids",
    );
  }
  if (connections && value.execution !== "script") {
    throw new Error(
      'contract.json connections are supported only when execution is "script"',
    );
  }
  const timeoutMs =
    value.timeoutMs === undefined
      ? undefined
      : typeof value.timeoutMs === "number" &&
          Number.isInteger(value.timeoutMs) &&
          value.timeoutMs >= 1_000 &&
          value.timeoutMs <= 6 * 60 * 60 * 1_000
        ? value.timeoutMs
        : null;
  if (timeoutMs === null) {
    throw new Error(
      "contract.json timeoutMs must be an integer from 1000 to 21600000",
    );
  }
  if (timeoutMs !== undefined && value.execution !== "script") {
    throw new Error(
      'contract.json timeoutMs is supported only when execution is "script"',
    );
  }
  const requiredSubagents =
    value.requiredSubagents === undefined
      ? undefined
      : Array.isArray(value.requiredSubagents) &&
          value.requiredSubagents.length > 0 &&
          value.requiredSubagents.every(
            (name) =>
              typeof name === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(name),
          )
        ? [...new Set(value.requiredSubagents as string[])]
        : null;
  if (requiredSubagents === null) {
    throw new Error(
      "contract.json requiredSubagents must contain valid specialist names",
    );
  }
  if (requiredSubagents && value.execution !== "agent") {
    throw new Error(
      'contract.json requiredSubagents are supported only when execution is "agent"',
    );
  }
  const deliveryPathAllowlist = parseDeliveryPathAllowlist(
    value.deliveryPathAllowlist,
  );
  const deliveryConfigAllowlist = parseDeliveryConfigAllowlist(
    value.deliveryConfigAllowlist,
  );
  if (
    deliveryConfigAllowlist &&
    Object.keys(deliveryConfigAllowlist).some(
      (filePath) => !deliveryPathAllowlist?.includes(filePath),
    )
  ) {
    throw new Error(
      "contract.json deliveryConfigAllowlist files must also be deliveryPathAllowlist entries",
    );
  }
  const unsupported = Object.keys(value).filter(
    (key) =>
      key !== "execution" &&
      key !== "deliveryPolicy" &&
      key !== "deliveryPathAllowlist" &&
      key !== "deliveryConfigAllowlist" &&
      key !== "requirements" &&
      key !== "connections" &&
      key !== "secrets" &&
      key !== "timeoutMs" &&
      key !== "requiredSubagents" &&
      key !== "input" &&
      key !== "output",
  );
  if (unsupported.length > 0) {
    throw new Error(
      `contract.json contains unsupported fields: ${unsupported.join(", ")}`,
    );
  }
  return {
    ...(value.execution ? { execution: value.execution } : {}),
    ...(value.deliveryPolicy === "checkpoint"
      ? { deliveryPolicy: value.deliveryPolicy }
      : {}),
    ...(deliveryPathAllowlist ? { deliveryPathAllowlist } : {}),
    ...(deliveryConfigAllowlist ? { deliveryConfigAllowlist } : {}),
    ...(requirements && Object.keys(requirements).length > 0
      ? { requirements }
      : {}),
    ...(connections ? { connections } : {}),
    ...(secrets ? { secrets } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(requiredSubagents ? { requiredSubagents } : {}),
    input: value.input as Record<string, unknown>,
    output: value.output as Record<string, unknown>,
  };
}

function parseUserBrowserActions(
  value: unknown,
): UserBrowserAction[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > USER_BROWSER_ACTIONS.length ||
    !value.every(
      (action): action is UserBrowserAction =>
        typeof action === "string" &&
        USER_BROWSER_ACTIONS.includes(action as UserBrowserAction),
    )
  ) {
    throw new Error(
      `contract.json requirements.browserActions must contain only ${USER_BROWSER_ACTIONS.join(", ")}`,
    );
  }
  return [...new Set(value)];
}

function parseUserBrowserOrigins(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(
      "contract.json requirements.browserOrigins must be a non-empty array",
    );
  }
  const origins = value.map((raw) => {
    if (typeof raw !== "string") throw new Error("invalid browser origin");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("invalid browser origin");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== raw.replace(/\/$/, "")
    ) {
      throw new Error(
        "contract.json requirements.browserOrigins must contain HTTPS origins only",
      );
    }
    return parsed.origin;
  });
  return [...new Set(origins)];
}

function parseUserBrowserFileRoots(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error(
      "contract.json requirements.browserFileRoots must be a non-empty array",
    );
  }
  const roots = value.map((raw) => {
    if (typeof raw !== "string") throw new Error("invalid browser file root");
    const root = raw.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (
      !root ||
      root.length > 300 ||
      root.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(
        "contract.json requirements.browserFileRoots contains an unsafe path",
      );
    }
    return root;
  });
  return [...new Set(roots)];
}

export function readUserBrowserGrant(
  rawContract: string | null,
): UserBrowserGrant | null {
  if (!rawContract) return null;
  const contract = parseCapabilityContract(rawContract);
  const requirements = contract.requirements;
  if (requirements?.browserSession !== "user") return null;
  return {
    actions: requirements.browserActions ?? [],
    origins: requirements.browserOrigins ?? [],
    fileRoots: requirements.browserFileRoots ?? [],
  };
}

function parseDeliveryConfigAllowlist(
  raw: unknown,
): Record<string, string[]> | undefined {
  if (raw === undefined) return undefined;
  const value = asRecord(raw);
  if (!value || Object.keys(value).length === 0) {
    throw new Error(
      "contract.json deliveryConfigAllowlist must be a non-empty object",
    );
  }
  const parsed: Record<string, string[]> = {};
  for (const [filePath, paths] of Object.entries(value)) {
    if (
      filePath !== "kody.config.json" ||
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.length > 32 ||
      !paths.every(
        (path) =>
          typeof path === "string" &&
          /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(path),
      )
    ) {
      throw new Error(
        "contract.json deliveryConfigAllowlist contains an unsupported config file or path list",
      );
    }
    parsed[filePath] = [...new Set(paths as string[])];
  }
  return parsed;
}

function parseDeliveryPathAllowlist(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
    throw new Error(
      "contract.json deliveryPathAllowlist must contain 1 to 64 paths",
    );
  }
  if (!raw.every((value) => typeof value === "string")) {
    throw new Error("contract.json deliveryPathAllowlist must contain paths");
  }
  const paths = [...new Set(raw as string[])];
  for (const value of paths) {
    const subtree = value.endsWith("/**");
    const base = subtree ? value.slice(0, -3) : value;
    const segments = base.split("/");
    const allowedHiddenPath =
      base.startsWith(".github/") ||
      base === ".kody-engine/definitions/loops" ||
      base.startsWith(".kody-engine/definitions/loops/");
    if (
      !base ||
      base.startsWith("/") ||
      (base.startsWith(".") && !allowedHiddenPath) ||
      base.includes("\\") ||
      base.includes("..") ||
      base.includes("*") ||
      segments.some((segment) => !segment) ||
      (subtree && segments.length < 2) ||
      value === ".github/**"
    ) {
      throw new Error(
        `contract.json deliveryPathAllowlist contains an unsafe path: ${value}`,
      );
    }
  }
  return paths;
}

export async function writeCapabilityFolderFiles(
  options: WriteCapabilityFolderFilesOptions,
): Promise<void> {
  if (!isValidSlug(options.slug)) {
    throw new Error(`Invalid capability slug: "${options.slug}".`);
  }
  assertSimpleCapabilityFolder(options.files);
  const now = new Date().toISOString();
  const bundle: DefinitionBundle = {
    schemaVersion: 1,
    files: { ...options.files },
  };
  const backend = createBackendClient();
  await backend.mutation(api.definitions.publish, {
    tenantId: tenantId(),
    kind: "capability",
    slug: options.slug,
    version: definitionVersion(bundle),
    bundle,
    source: "local",
    createdAt: now,
  });
  // Remove the pre-definition storage row after a successful publish. Reads
  // still support it so existing capabilities migrate on their next save.
  await backend.mutation(api.repoDocs.remove, {
    tenantId: tenantId(),
    kind: `${KIND_PREFIX}${options.slug}`,
  });
}

export async function deleteCapabilityFile(slug: string): Promise<void> {
  if (!isValidSlug(slug)) {
    throw new Error(`Invalid capability slug: "${slug}".`);
  }
  const backend = createBackendClient();
  await backend.mutation(api.definitions.retire, {
    tenantId: tenantId(),
    kind: "capability",
    slug,
  });
  await backend.mutation(api.repoDocs.remove, {
    tenantId: tenantId(),
    kind: `${KIND_PREFIX}${slug}`,
  });
}
