import { describe, expect, it } from "vitest";

import {
  capabilitiesForScope,
  personalScopeFor,
  repositoryScopeFor,
  isPersonalDashboardPath,
} from "@dashboard/lib/kody-scope";

describe("Kody scope", () => {
  it("keeps personal routes outside repository routing", () => {
    expect(isPersonalDashboardPath("/chat/conversation-1")).toBe(true);
    expect(isPersonalDashboardPath("/commands/edit")).toBe(true);
    expect(isPersonalDashboardPath("/memory")).toBe(true);
    expect(isPersonalDashboardPath("/guided-flows")).toBe(true);
    expect(isPersonalDashboardPath("/workflows")).toBe(false);
  });

  it("gives every signed-in user the complete personal Kody capability set", () => {
    const scope = personalScopeFor("user-1");

    expect(capabilitiesForScope(scope)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(capabilitiesForScope(scope)).not.toContain("repository-code");
  });

  it("adds repository capabilities without removing personal capabilities", () => {
    const scope = repositoryScopeFor("user-1", "acme", "app");
    const capabilities = capabilitiesForScope(scope);

    expect(capabilities).toEqual(
      expect.arrayContaining([
        "chat",
        "models",
        "instructions",
        "guided-flows",
        "repository-code",
        "repository-tasks",
        "repository-reports",
        "repository-workflows",
        "repository-agency",
        "repository-secrets",
      ]),
    );
  });
});
