export interface KodyTerminalIntent {
  intent: string;
}

const TERMINAL_COMMAND_RE = /^\/terminal(?:\s+)([\s\S]*?)\s*$/i;
const TERMINAL_BLOCK_RE = /```[ \t]*terminal[^\r\n]*(?:\r?\n)([\s\S]*?)```/gi;

export function parseKodyTerminalIntent(
  input: string,
): KodyTerminalIntent | null {
  const match = input.match(TERMINAL_COMMAND_RE);
  const intent = match?.[1]?.trim();
  return intent ? { intent } : null;
}

export function buildKodyTerminalPrompt(intent: string): string {
  return [
    "Turn the user's request into shell commands for the local terminal.",
    "Reply with exactly one fenced code block labeled terminal.",
    "Do not include prose before or after the block.",
    "Do not explain, mention Kody, mention the dashboard, or add status text.",
    "The block contents will be executed in a shell exactly as written.",
    "Use multiline shell input when it makes execution clearer or safer.",
    "",
    "User terminal intent:",
    intent.trim(),
  ].join("\n");
}

export function extractKodyTerminalPayload(response: string): string | null {
  const matches = [...response.matchAll(TERMINAL_BLOCK_RE)];
  if (matches.length !== 1) return null;
  const payload = matches[0]?.[1]?.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return payload && payload.trim() ? payload : null;
}
