import { resolve } from "node:path";
import { config } from "dotenv";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";

import type { ChatModel } from "@kody-ade/base/variables/models";
import { formatFeatureGuidePromptSection } from "@kody-ade/kody-chat-dashboard/platform/feature-guide-context";
import { createFileFeatureGuideProvider } from "@dashboard/lib/feature-guides/server";
import { chatModelAdapter } from "../../../../packages/kody-chat-dashboard/app/api/kody/chat/model-adapters";

config({
  path: resolve(import.meta.dirname, "../../../../.env"),
  quiet: true,
});

const RUN_LIVE = process.env.RUN_FEATURE_GUIDE_EVAL === "1";
const provider = createFileFeatureGuideProvider({
  rootDirectory: resolve(import.meta.dirname, "../../src/dashboard/features"),
});

const model: ChatModel = {
  id: "minimax/MiniMax-M3",
  label: "MiniMax M3",
  provider: "minimax",
  adapter: "openai-compatible",
  adapterBaseURL: "https://api.minimax.io/v1",
  protocol: "openai",
  baseURL: "https://api.minimax.io/v1",
  modelName: "MiniMax-M3",
  apiKeySecret: "MINIMAX_API_KEY",
  enabled: true,
};

interface EvalCase {
  id: string;
  currentPage: string;
  question: string;
  facts: Array<{ label: string; patterns: RegExp[] }>;
}

const cases: EvalCase[] = [
  {
    id: "workflow-boundaries-away-from-page",
    currentPage: "the Inbox page (/inbox)",
    question:
      "What are the hard constraints around scheduling, cycles, and Store editing for Workflows?",
    facts: [
      {
        label: "scheduling belongs to Loop or trigger",
        patterns: [/loop|event trigger/i, /schedul|recurr/i],
      },
      {
        label: "cycles must be bounded",
        patterns: [/maxIterations|finite|bounded/i, /cycle|backward edge/i],
      },
      {
        label: "Store workflows are read-only",
        patterns: [/store workflow/i, /read.?only|cannot be edited|can.?t edit/i],
      },
    ],
  },
  {
    id: "workflow-success-evidence",
    currentPage: "the Workflows page (/workflows)",
    question:
      "A Workflow dispatch was accepted. Is that enough to call it successful, and what can trust or approval not bypass?",
    facts: [
      {
        label: "dispatch acceptance is not success",
        patterns: [/not enough|does not|isn.?t|cannot/i, /dispatch/i],
      },
      {
        label: "final Engine evidence is required",
        patterns: [/engine/i, /final|evidence|output|state/i],
      },
      {
        label: "trust cannot bypass hard requirements",
        patterns: [/trust|approval/i, /permission|secret|engine|restriction/i],
      },
    ],
  },
  {
    id: "file-space-deletion-and-content",
    currentPage: "the Files page (/files)",
    question:
      "Explain what deleting or reordering a File Space changes, and which repository files appear inside one.",
    facts: [
      {
        label: "deletion keeps repository files",
        patterns: [/remov|delet/i, /config|space/i, /repository files|files.*remain|does not delete/i],
      },
      {
        label: "reordering does not move folders",
        patterns: [/reorder/i, /does not move|doesn.?t move|not move/i],
      },
      {
        label: "spaces are rooted and Markdown-only",
        patterns: [/root/i, /markdown|\.md/i, /only|outside|non-markdown/i],
      },
    ],
  },
  {
    id: "memory-lifecycle",
    currentPage: "the Memory page (/memory)",
    question:
      "How do Memory scope changes, revisions, deletion, and current-fact reliability work?",
    facts: [
      {
        label: "scope cannot be changed by editing",
        patterns: [/scope/i, /cannot|can.?t|fixed|immutable/i],
      },
      {
        label: "edits preserve revisions",
        patterns: [/edit|update/i, /revision|history/i],
      },
      {
        label: "deletion removes history and is not recoverable",
        patterns: [/delet/i, /history|revision/i, /cannot be undone|irreversible|not recover/i],
      },
      {
        label: "memory is not proof of current facts",
        patterns: [
          /not[\s\S]*proof|does not prove|verify/i,
          /current|external|live/i,
        ],
      },
    ],
  },
  {
    id: "preview-inspection-boundaries",
    currentPage: "the Views page (/preview)",
    question:
      "What can block element inspection in Views, and does approving what I see prove the change passed?",
    facts: [
      {
        label: "iframe or cross-origin restrictions can block inspection",
        patterns: [/iframe|cross-origin|CSP|content security/i],
      },
      {
        label: "inspection depends on the bridge",
        patterns: [/bridge|extension/i, /active|installed|access/i],
      },
      {
        label: "visual approval is not CI proof",
        patterns: [/approv|visual/i, /does not|doesn.?t|not.*prove|cannot/i, /test|CI|merge/i],
      },
    ],
  },
  {
    id: "explicit-feature-beats-route",
    currentPage: "the Tasks page (/tasks)",
    question:
      "For File Spaces, what happens when the root is outside the allowed area or the file is not Markdown?",
    facts: [
      {
        label: "space cannot access outside its root",
        patterns: [/outside/i, /root/i, /cannot|can.?t|not accessible|restricted/i],
      },
      {
        label: "non-Markdown files are hidden",
        patterns: [/non-markdown|not markdown|markdown/i, /not appear|hidden|won.?t show|cannot/i],
      },
    ],
  },
];

function factPasses(text: string, fact: EvalCase["facts"][number]): boolean {
  return fact.patterns.every((pattern) => pattern.test(text));
}

function visibleAnswer(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

describe.skipIf(!RUN_LIVE)("feature guide live A/B evaluation", () => {
  it(
    "improves Dashboard feature understanding over the no-guide baseline",
    async () => {
      const key = process.env.MINIMAX_API_KEY;
      expect(key, "MINIMAX_API_KEY is required").toBeTruthy();
      const languageModel = chatModelAdapter(model).create(model, key!);
      const rows: Array<Record<string, unknown>> = [];

      for (const evalCase of cases) {
        const guide = await provider.resolveForTurn({
          currentPage: evalCase.currentPage,
          userText: evalCase.question,
        });
        expect(guide, `${evalCase.id} must resolve a guide`).not.toBeNull();

        for (const variant of ["baseline", "guided"] as const) {
          const startedAt = performance.now();
          const result = await generateText({
            model: languageModel,
            system: [
              "You are Kody, the Dashboard assistant.",
              "Answer the product question accurately and concisely.",
              "Do not invent behavior. State important unsupported behavior and constraints.",
              variant === "guided"
                ? formatFeatureGuidePromptSection(guide!)
                : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            prompt: `${evalCase.currentPage}\n\nUser: ${evalCase.question}`,
            temperature: 0,
            maxOutputTokens: 500,
            timeout: 90_000,
          });
          const answer = visibleAnswer(result.text);
          const passedFacts = evalCase.facts.filter((fact) =>
            factPasses(answer, fact),
          );
          rows.push({
            case: evalCase.id,
            expectedGuide: guide!.id,
            variant,
            passed: passedFacts.length,
            possible: evalCase.facts.length,
            factResults: evalCase.facts.map((fact) => ({
              fact: fact.label,
              passed: passedFacts.includes(fact),
            })),
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            latencyMs: Math.round(performance.now() - startedAt),
            answer,
          });
        }
      }

      const totals = (variant: "baseline" | "guided") => {
        const selected = rows.filter((row) => row.variant === variant);
        return {
          factsPassed: selected.reduce(
            (sum, row) => sum + Number(row.passed),
            0,
          ),
          factsPossible: selected.reduce(
            (sum, row) => sum + Number(row.possible),
            0,
          ),
          inputTokens: selected.reduce(
            (sum, row) => sum + Number(row.inputTokens ?? 0),
            0,
          ),
          outputTokens: selected.reduce(
            (sum, row) => sum + Number(row.outputTokens ?? 0),
            0,
          ),
          latencyMs: selected.reduce(
            (sum, row) => sum + Number(row.latencyMs),
            0,
          ),
        };
      };
      const baseline = totals("baseline");
      const guided = totals("guided");

      console.log(
        "FEATURE_GUIDE_AB_RESULT",
        JSON.stringify({ model: model.id, baseline, guided, rows }, null, 2),
      );

      expect(guided.factsPassed).toBeGreaterThan(baseline.factsPassed);
      expect(guided.factsPassed / guided.factsPossible).toBeGreaterThanOrEqual(
        0.8,
      );
    },
    600_000,
  );
});
