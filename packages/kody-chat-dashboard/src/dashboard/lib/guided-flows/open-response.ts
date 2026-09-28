interface GuidedFlowOpenPayload {
  readonly view?: unknown;
  readonly compatibility?: {
    readonly status?: unknown;
    readonly code?: unknown;
  };
  readonly flow?: Readonly<Record<string, unknown>> & {
    readonly view?: unknown;
    readonly compatibility?: {
      readonly status?: unknown;
      readonly code?: unknown;
    };
  };
}

export function readGuidedFlowOpenPayload(
  payload: GuidedFlowOpenPayload | null,
): Pick<GuidedFlowOpenPayload, "view" | "compatibility"> {
  return {
    view: payload?.view ?? payload?.flow?.view,
    compatibility:
      payload?.compatibility ?? payload?.flow?.compatibility,
  };
}
