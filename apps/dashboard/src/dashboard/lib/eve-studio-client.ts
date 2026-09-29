type McpContent = { type: string; text?: string };
type McpToolResult = {
  isError?: boolean;
  content?: McpContent[];
  structuredContent?: Record<string, unknown>;
};

const endpoint = () =>
  process.env.EVE_STUDIO_MCP_URL?.trim() ||
  "https://agents.thedigitalreality.app/api/mcp";

function resultBody(result: McpToolResult): Record<string, unknown> {
  if (result.isError) {
    const message = result.content?.find((item) => item.type === "text")?.text;
    throw new Error(message || "Eve Studio rejected the request.");
  }
  if (result.structuredContent) return result.structuredContent;
  const value = result.content?.find((item) => item.type === "text")?.text;
  if (!value) throw new Error("Eve Studio returned no result.");
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch {
    // Native Eve responses normally include structured content. Keep the
    // human-readable response for an actionable error when they do not.
  }
  throw new Error(value.slice(0, 300));
}

export async function callEveStudioTool(
  name: "agent_start" | "agent_get" | "agent_update",
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = process.env.EVE_STUDIO_MCP_TOKEN?.trim();
  if (!token) throw new Error("Eve Studio is not connected to Fly Hub.");
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Eve Studio request failed (HTTP ${response.status}).`);
  const payload = (await response.json()) as {
    error?: { message?: string };
    result?: McpToolResult;
  };
  if (payload.error)
    throw new Error(payload.error.message || "Eve Studio failed.");
  if (!payload.result) throw new Error("Eve Studio returned no result.");
  return resultBody(payload.result);
}
import { randomUUID } from "node:crypto";
