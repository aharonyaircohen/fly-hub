import {
  createWorkflowRunApproval,
  readWorkflowRunApprovalToken,
} from "./workflow-run-approval";

interface RequestContext {
  url: string;
  headers: Headers;
}

interface WorkflowCommand {
  workflowId: string;
  input: Record<string, unknown>;
}

interface WorkflowApprovalContext {
  owner: string;
  repo: string;
  latestUserText: string | null;
}

interface WorkflowRunOptions {
  approvedByConfiguration?: boolean;
}

async function workflowResult(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (response.ok) return payload;
  return {
    error:
      typeof payload.error === "string"
        ? payload.error
        : "workflow_request_failed",
    ...(response.status < 500 && typeof payload.message === "string"
      ? { message: payload.message }
      : {}),
    ...(response.status < 500 && Array.isArray(payload.issues)
      ? { issues: payload.issues }
      : {}),
    ...(response.status === 409 && typeof payload.approvalToken === "string"
      ? { approvalToken: payload.approvalToken }
      : {}),
    status: response.status,
  };
}

function requestHeaders(request: RequestContext): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return headers;
}

export function createWorkflowApiClient({
  request,
  approval,
  fetchImpl = fetch,
}: {
  request: RequestContext;
  approval: WorkflowApprovalContext;
  fetchImpl?: typeof fetch;
}) {
  let approvalSubmitted = false;
  return {
    async list(): Promise<unknown> {
      return workflowResult(
        await fetchImpl(new URL("/api/kody/company/workflows", request.url), {
          method: "GET",
          headers: requestHeaders(request),
          cache: "no-store",
        }),
      );
    },

    async read(workflowId: string, includeStore = false): Promise<unknown> {
      const storeQuery = includeStore ? "?includeStore=true" : "";
      return workflowResult(
        await fetchImpl(
          new URL(
            `/api/kody/company/workflows/${encodeURIComponent(workflowId)}${storeQuery}`,
            request.url,
          ),
          {
            method: "GET",
            headers: requestHeaders(request),
            cache: "no-store",
          },
        ),
      );
    },

    async run(
      command: WorkflowCommand,
      options: WorkflowRunOptions = {},
    ): Promise<unknown> {
      const headers = requestHeaders(request);
      headers.set("content-type", "application/json");
      let approvalId: string | undefined;
      const approvalToken = approvalSubmitted
        ? null
        : readWorkflowRunApprovalToken(approval.latestUserText);
      if (approvalToken) {
        approvalSubmitted = true;
        const approvalResult = await workflowResult(
          await fetchImpl(
            new URL(
              `/api/kody/company/workflows/${encodeURIComponent(command.workflowId)}/approve`,
              request.url,
            ),
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                approvalToken,
                input: command.input,
              }),
            },
          ),
        );
        if (typeof approvalResult.approvalId !== "string") {
          return approvalResult;
        }
        approvalId = approvalResult.approvalId;
      }
      const response = await fetchImpl(
        new URL(
          `/api/kody/company/workflows/${encodeURIComponent(command.workflowId)}/run`,
          request.url,
        ),
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...(approvalId ? { approvalId } : {}),
            input: command.input,
          }),
        },
      );
      const result = await workflowResult(response);
      if (result.error !== "approval_required") return result;
      if (typeof result.approvalToken !== "string") return result;
      if (options.approvedByConfiguration) {
        const approvalResult = await workflowResult(
          await fetchImpl(
            new URL(
              `/api/kody/company/workflows/${encodeURIComponent(command.workflowId)}/approve`,
              request.url,
            ),
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                approvalToken: result.approvalToken,
                input: command.input,
              }),
            },
          ),
        );
        if (typeof approvalResult.approvalId !== "string") {
          return approvalResult;
        }
        return workflowResult(
          await fetchImpl(
            new URL(
              `/api/kody/company/workflows/${encodeURIComponent(command.workflowId)}/run`,
              request.url,
            ),
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                approvalId: approvalResult.approvalId,
                input: command.input,
              }),
            },
          ),
        );
      }
      return createWorkflowRunApproval({
        owner: approval.owner,
        repo: approval.repo,
        workflowId: command.workflowId,
        workflowInput: command.input,
        approvalToken: result.approvalToken,
      });
    },
  };
}
