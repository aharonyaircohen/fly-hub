/**
 * @fileType route
 * @domain kody
 * @pattern report-kody-bug
 * @ai-summary POST a bug report about Kody itself (dashboard/engine) into the
 *   owning Kody product's public repo — not the consumer's connected repo.
 *   Attributed to the reporter's PAT (works on a public repo without
 *   collaborator access).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import {
  clearGitHubContext,
  createIssue,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  KODY_BUG_AREAS,
  KODY_BUG_SEVERITIES,
  KODY_CHAT_REPORT_TARGET,
  KODY_REPORT_TARGET,
} from "@kody-ade/base/constants";
import { logger } from "@kody-ade/base/logger";

const diagnosticsSchema = z
  .object({
    userAgent: z.string().optional(),
    platform: z.string().optional(),
    screen: z.string().optional(),
    viewport: z.string().optional(),
    url: z.string().optional(),
    referrer: z.string().optional(),
    timezone: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .optional();

const capturedStateSchema = z
  .object({
    sections: z
      .array(
        z.object({
          title: z.string().min(1).max(80),
          items: z
            .array(
              z.object({
                label: z.string().min(1).max(80),
                value: z.string().max(2_000),
              }),
            )
            .max(20),
        }),
      )
      .max(8)
      .optional(),
    recentMessages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(2_000),
        }),
      )
      .max(8)
      .optional(),
    recentToolCalls: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          status: z.string().min(1).max(30),
          summary: z.string().max(1_000).optional(),
        }),
      )
      .max(12)
      .optional(),
  })
  .optional();

const reportSchema = z.object({
  title: z.string().min(1).max(200),
  area: z.enum(KODY_BUG_AREAS),
  severity: z.enum(KODY_BUG_SEVERITIES),
  whatHappened: z.string().min(1),
  steps: z.string().optional(),
  expected: z.string().optional(),
  where: z.string().optional(),
  reporterLogin: z.string().optional(),
  diagnostics: diagnosticsSchema,
  capturedState: capturedStateSchema,
  source: z.enum(["kody-dashboard", "kody-chat"]).default("kody-dashboard"),
});

type ReportInput = z.infer<typeof reportSchema>;

const SEVERITY_BADGE: Record<(typeof KODY_BUG_SEVERITIES)[number], string> = {
  blocker: "🟥 Blocker",
  major: "🟧 Major",
  minor: "🟨 Minor",
};

function section(heading: string, value?: string): string {
  const body = value?.trim() ? value.trim() : "_Not specified_";
  return `## ${heading}\n${body}\n\n`;
}

function fence(value: string): string {
  return value.replace(/```/g, "'''");
}

function formatCapturedState(input: ReportInput): string {
  const state = input.capturedState;
  if (!state) return "";

  const sections = state.sections ?? [];
  const messages = state.recentMessages ?? [];
  const tools = state.recentToolCalls ?? [];
  if (sections.length === 0 && messages.length === 0 && tools.length === 0) {
    return "";
  }

  let md = "<details>\n<summary>Captured chat state</summary>\n\n";

  for (const section of sections) {
    if (section.items.length === 0) continue;
    md += `### ${section.title}\n`;
    md += section.items
      .map(({ label, value }) => `- **${label}:** ${value}`)
      .join("\n");
    md += "\n\n";
  }

  if (tools.length > 0) {
    md += "### Recent tool calls\n";
    md += tools
      .map((tool) => {
        const summary = tool.summary ? ` — ${tool.summary}` : "";
        return `- **${tool.name}:** ${tool.status}${summary}`;
      })
      .join("\n");
    md += "\n\n";
  }

  if (messages.length > 0) {
    md += "### Recent visible messages\n";
    for (const message of messages) {
      md += `**${message.role}:**\n\n\`\`\`\n${fence(message.text)}\n\`\`\`\n\n`;
    }
  }

  md += "</details>\n\n";
  return md;
}

function formatBody(input: ReportInput): string {
  const { area, severity, whatHappened, steps, expected, where, diagnostics } =
    input;

  let md = "## Summary\n";
  md += `**Area:** ${area} • **Severity:** ${SEVERITY_BADGE[severity]}\n\n`;
  md += section("What happened", whatHappened);
  md += section("Steps to reproduce", steps);
  md += section("Expected result", expected);
  md += section("Where it happened", where);

  const d = diagnostics ?? {};
  const rows = [
    ["Reported by", input.reporterLogin ? `@${input.reporterLogin}` : null],
    ["URL", d.url],
    ["Came from", d.referrer],
    ["Browser", d.userAgent],
    ["Platform", d.platform],
    ["Screen", d.screen],
    ["Viewport", d.viewport],
    ["Timezone", d.timezone],
    ["Captured at", d.timestamp],
  ].filter(([, v]) => Boolean(v)) as Array<[string, string]>;

  if (rows.length > 0) {
    md += "<details>\n<summary>Diagnostics (auto-captured)</summary>\n\n";
    md += rows.map(([k, v]) => `- **${k}:** ${v}`).join("\n");
    md += "\n\n</details>\n\n";
  }

  md += formatCapturedState(input);

  md += "---\n_Filed from the Kody dashboard “Report a Kody bug” form._";
  return md;
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const input = reportSchema.parse(await req.json());
    const actorResult = await verifyActorLogin(req, input.reporterLogin);
    if (actorResult instanceof NextResponse) return actorResult;

    const reporterLogin = actorResult.identity.login;

    // Select the owning Kody product, never the consumer's connected repo.
    // Keep the reporter's token so the issue is attributed to them.
    const target =
      input.source === "kody-chat"
        ? KODY_CHAT_REPORT_TARGET
        : KODY_REPORT_TARGET;
    const headerAuth = getRequestAuth(req);
    setGitHubContext(target.owner, target.repo, headerAuth?.token ?? "");

    const userOctokit = await getUserOctokit(req);

    const labels = [
      "bug",
      "kody-report",
      `area:${input.area}`,
      `severity:${input.severity}`,
    ];

    const issue = await createIssue(
      {
        title: `[${input.area}] ${input.title}`,
        body: formatBody({ ...input, reporterLogin }),
        labels,
        assignees: [reporterLogin],
      },
      userOctokit ?? undefined,
    );

    logger.info(
      {
        issue: issue.number,
        source: input.source,
        area: input.area,
        severity: input.severity,
      },
      "Kody bug report filed",
    );

    return NextResponse.json({
      success: true,
      issue: {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
      },
    });
  } catch (error: unknown) {
    const err =
      error && typeof error === "object"
        ? (error as { status?: number; message?: string })
        : null;
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 },
      );
    }
    if (err?.status === 401) {
      return NextResponse.json(
        {
          error: "github_token_expired",
          message: "Your GitHub session expired. Please log in again.",
        },
        { status: 401 },
      );
    }
    if (err?.status === 403 || err?.status === 404) {
      return NextResponse.json(
        {
          error: "cannot_file",
          message:
            "Could not open an issue on the Kody repo. It may be private or have issues disabled.",
        },
        { status: 502 },
      );
    }
    logger.error({ err: error }, "Failed to file Kody bug report");
    return NextResponse.json(
      { error: "Failed to file bug report", details: err?.message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
