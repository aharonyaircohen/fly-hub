Deep Project Assessment – aharonyaircohen/kody-chat

1. Overall Scope
   Monorepo structure contains 19 core packages and the main dashboard (apps/dashboard).
   Primary purpose: a repository‑aware control system that unifies Chat, knowledge, agents, reusable capabilities, workflows, previews, files, and operational signals for autonomous engineering workloads.
   The Dashboard (kody-dashboard) is the single‑repo UI for monitoring tasks, managing autonomous capabilities, running agents, approving gates, reviewing PRs, and interacting with Kody’s chat interface.
2. Repository Layout & Key Packages
   Path Package Core Responsibility
   packages/agency Agency definitions – models for Intent, Todo, Agent, Capability, Workflow, Loop, Run.
   packages/brain Brain runtime – long‑lived conversational controller that orchestrates agents and workflows.
   packages/engine-contracts Provider‑neutral request contracts for engine execution (brain, runners, Fly, Actions).
   packages/cms Content Management System – models, adapters, routes, tools for structured content.
   packages/memory Memory domain – pure memory contracts and application logic.
   packages/engine-contracts Engine‑level contracts – schema, stores, and API interfaces used across packages.
   packages/kody-backend Convex‑backed server logic – schemas, helpers, functions for the engine, agents, capabilities, runs, etc.
   packages/fly Preview & runner infrastructure – Fly.io deployments, builder tooling, and related runners.
   packages/base Core shared contracts – auth, vault, storage, event bus, OS‑level utilities.
   apps/dashboard React dashboard – UI for repository context, task board, capability manager, PR viewer, previews, vault, notifications, etc.
   All packages export a package.json with TypeScript and are linked through shared type utilities, constants, and auth infrastructure.

3. Architectural Principles (derived from docs/project-behavior.md & CLAUDE.md)
   Principle Implication
   One canonical repo‑scoped URL (/repo/:owner/:repo/...) UI routes must preserve the active <owner>/<repo> context; internal rewrites are never exposed to users.
   Hard boundaries for execution Engine runs code, preview executables own preview logic, policies enforce gate requirements.
   Secrets are user‑scoped All per‑user credentials live in the dashboard Settings page or encrypted vault, never in deployment env vars.
   Push > Poll GitHub webhooks drive invalidation; polling is only a fallback.
   Clean architecture Modular separation by concern; no “god routes”. Change to a repository‑scoped feature must pass a verification checklist involving the canonical route, API layer, and storage.
   User‑visible verification Unit tests alone do not verify UI; the canonical Dashboard URL must be exercised end‑to‑end.
4. Dashboard Functionality (high‑level feature set)
   Task Board – inbox → spec → building → review → done, with drag‑and‑drop.
   Capability Manager – markdown‑defined capabilities stored under backend definitions (capabilities).
   Parallel Execution – each task runs as an isolated GitHub Actions workflow.
   PR Viewer – file diffs, CI status, gate approvals.
   Live Previews – per‑PR Fly.io environments (docs/previews.md).
   Encrypted Vault – per‑repo secrets (KODY_MASTER_KEY → AES‑256‑GCM) accessible only via dashboard UI.
   Multi‑provider Chat Backend – supports OpenAI‑compatible, Anthropic, Gemini, Groq, OpenRouter, Mistral, DeepSeek, xAI, etc.
   Real‑time Pipeline Status – GitHub webhooks (push‑based) for CI/CD updates.
   Notifications – in‑app & desktop alerts.
   Agent & Workflow Management – agencies can be defined, versioned, and scheduled.
   The UI is built with Next.js App Router, using a clear separation of pages (app/), API routes (app/api/kody/), components, and hooks (src/dashboard/lib/**).

5. Recent Development Activity
   Area Recent Changes (last 20 commits)
   Chat / Workflows Fixes to route workflow runs, enforce shared execution contracts, stop forced specialist tool loops, expose workflow validation errors.
   Agency & Runs Enable operations to run workflows, preserve parent tool access, add UI review acceptance fixture (PR #17).
   Testing Infrastructure Added CI pipeline with coverage thresholds, added e2e gate that runs Playwright tests, introduced rtk command filtering for output efficiency.
   Documentation & Learning Updates to project-behavior.md, AGENTS.md, and README.md to clarify repository‑scoped URL rules and verification checklist.
   New Feature UI acceptance test fixture added (draft PR, not intended for merge).
   Miscellaneous Memory improvements (workflow‑engine integration), bug fixes for malformed tool calls, retries, checkpoint handling.
   Open Pull Request

#17 – “test: add UI review acceptance fixture” (draft, not mergeable). Adds a temporary banner to the Inbox page for UI‑review testing and includes a focused test. Intended only as an experimental fixture. 6. CI / Testing Overview
CI Workflow (/.github/workflows/ci.yml) runs on push/PR, performs:

Install → Typecheck → Lint → Production build.
Unit & integration tests with coverage thresholds for dashboard, kody‑chat, brain, and other packages.
E2E gate (pnpm --filter kody-dashboard test:e2e:gate) that validates token scopes and secret presence.
Optional Convex smoke‑test suite (CONVEX_SMOKE_ENABLED).
Verification – Unit tests alone are insufficient for UI changes; canonical Dashboard routes must be exercised to confirm user‑visible behavior.

7. Documentation & Learning Resources
   Document Purpose
   README.md Project overview, quick‑start, runtime configuration, deployment steps.
   AGENTS.md Detailed description of all core packages and their responsibilities.
   project-behavior.md Rules governing repository‑scoped UI, routes, verification, change checklist.
   WHY-KODY.md Rationale for the platform, target audience, and motivation.
   Capability & Workflow docs (docs/capabilities.md, docs/workflows.md) Technical description of reusable methods and graph‑based sequencing.
   docs/project-behavior.md Source‑of‑truth for route ownership and verification rules.
   These documents also embed design principles (single env var per concern, cache discipline, clean architecture) that are enforced throughout the codebase.

8. Current Status & Maturity
   Active Development – Recent commits show continuous iteration on chat handling
   {"name": "github_commits_for_path", "arguments": {"path": "/", "perPage": 20}}
