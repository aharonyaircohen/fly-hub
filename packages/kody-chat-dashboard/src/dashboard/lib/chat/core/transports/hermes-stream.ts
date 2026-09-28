export type HermesStreamEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export async function consumeHermesStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: HermesStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length === 0) return;
    let value: unknown;
    try {
      value = JSON.parse(data.join("\n")) as unknown;
    } catch {
      // Ignore malformed keepalive or partial data frames.
    }
    if (value && typeof value === "object") {
      onEvent({ type: eventName, payload: value as Record<string, unknown> });
    }
    eventName = "message";
    data = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      dispatch();
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    dispatch();
  }
}
