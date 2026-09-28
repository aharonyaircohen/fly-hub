// Shared valid fixtures for schema-enforced documents.

export const NOW = "2026-07-15T00:00:00.000Z"

export function validIntent(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "i1",
    status: "active",
    for: "acme",
    priority: 1,
    posture: "balanced",
    scope: { repos: [], areas: [] },
    principles: [],
    metrics: [],
    policyRefs: [],
    controls: {
      automation: {
        authority: "full-auto",
        maxDailyActions: 10,
        requiresHumanFor: [],
      },
    },
    portfolio: { loops: [], capabilities: [] },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    at: NOW,
    agent: "cto",
    action: "created",
    reason: "test",
    ...overrides,
  }
}

export function validInboxEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    source: "mention",
    repoFullName: "acme/app",
    threadType: "Issue",
    title: "hello",
    snippet: "",
    url: "https://github.com/acme/app/issues/1",
    sentAt: NOW,
    readAt: null,
    ...overrides,
  }
}
