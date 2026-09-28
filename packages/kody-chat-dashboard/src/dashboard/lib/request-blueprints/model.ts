/** Information needed to understand and complete one kind of request. */
export interface RequestBlueprintRequirement {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly guidance: string;
  /** Kody discovers facts; the user supplies decisions and private context. */
  readonly source: "kody" | "user";
  readonly required: boolean;
}

export interface RequestBlueprintDefinition {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly purpose: string;
  readonly introduction?: {
    readonly title: string;
    readonly guidance: string;
    readonly actionLabel?: string;
  };
  readonly allowBack?: boolean;
  readonly requirements: readonly RequestBlueprintRequirement[];
  readonly completion?: {
    readonly submitLabel?: string;
    readonly handoff?: "agency-request.submit";
  };
}

export interface RequestBlueprintGenerationContext {
  readonly knownValues?: Readonly<Record<string, unknown>>;
}
