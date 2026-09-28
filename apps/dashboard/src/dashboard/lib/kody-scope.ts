export type KodyPersonalCapability =
  | "chat"
  | "conversations"
  | "attachments"
  | "models"
  | "credentials"
  | "preferences"
  | "secrets"
  | "instructions"
  | "commands"
  | "guided-flows"
  | "renderers"
  | "widgets"
  | "memory"
  | "brain";

export type KodyRepositoryCapability =
  | "repository-code"
  | "repository-tasks"
  | "repository-reports"
  | "repository-workflows"
  | "repository-agency"
  | "repository-secrets";

export type KodyCapability = KodyPersonalCapability | KodyRepositoryCapability;

export type KodyScope =
  | Readonly<{ kind: "personal"; userId: string }>
  | Readonly<{
      kind: "repository";
      userId: string;
      owner: string;
      repo: string;
    }>;

export const PERSONAL_DASHBOARD_PATHS = Object.freeze([
  "/chat",
  "/models",
  "/commands",
  "/guided-flows",
  "/views/renderers",
  "/views/widgets",
  "/instructions",
  "/secrets",
  "/memory",
  "/brain",
]);

export function isPersonalDashboardPath(pathname: string): boolean {
  return PERSONAL_DASHBOARD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

const PERSONAL_CAPABILITIES: readonly KodyPersonalCapability[] = [
  "chat",
  "conversations",
  "attachments",
  "models",
  "credentials",
  "preferences",
  "secrets",
  "instructions",
  "commands",
  "guided-flows",
  "renderers",
  "widgets",
  "memory",
  "brain",
];

const REPOSITORY_CAPABILITIES: readonly KodyRepositoryCapability[] = [
  "repository-code",
  "repository-tasks",
  "repository-reports",
  "repository-workflows",
  "repository-agency",
  "repository-secrets",
];

export function personalScopeFor(userId: string): KodyScope {
  return { kind: "personal", userId };
}

export function repositoryScopeFor(
  userId: string,
  owner: string,
  repo: string,
): KodyScope {
  return { kind: "repository", userId, owner, repo };
}

export function capabilitiesForScope(
  scope: KodyScope,
): readonly KodyCapability[] {
  return scope.kind === "repository"
    ? [...PERSONAL_CAPABILITIES, ...REPOSITORY_CAPABILITIES]
    : PERSONAL_CAPABILITIES;
}
