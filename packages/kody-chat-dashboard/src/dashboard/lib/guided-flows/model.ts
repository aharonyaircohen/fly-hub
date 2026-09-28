import type { GuidedFlowControlId } from "./control-contract";

export type GuidedFlowStatus = "active" | "completed" | "cancelled";

export type GuidedFlowActionTarget =
  | { readonly type: "step"; readonly stepId: string }
  | { readonly type: "stay" }
  | { readonly type: "complete" }
  | { readonly type: "cancel" };

export interface GuidedFlowActionDefinition {
  readonly id: string;
  readonly target: GuidedFlowActionTarget;
}

export interface GuidedFlowCmsItemsSource {
  readonly type: "cms";
  readonly collection: string;
  readonly labelField: string;
  readonly valueField: string;
  readonly resultField: string;
  readonly filter?: {
    readonly field: string;
    readonly fromResultField: string;
  };
}

export interface GuidedFlowStepBase {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly authoringGoal?: string;
  readonly routeId?: string;
  readonly routeParameters?: Readonly<Record<string, string>>;
  readonly actions: readonly GuidedFlowActionDefinition[];
}

export interface GuidedFlowViewStepDefinition extends GuidedFlowStepBase {
  readonly type?: "view";
  readonly rendererSlug: string;
  /** Exact renderer contract version. Legacy built-ins may omit this. */
  readonly rendererVersion?: number;
  readonly rendererData?: Readonly<Record<string, unknown>>;
  readonly itemsSource?: GuidedFlowCmsItemsSource;
  readonly filePicker?: {
    readonly resultField: string;
    readonly extensions?: readonly string[];
  };
}

export interface GuidedFlowNestedStepDefinition extends GuidedFlowStepBase {
  readonly type: "flow";
  readonly flowId: string;
  readonly flowVersion: number;
}

export interface GuidedFlowCommandStepDefinition extends GuidedFlowStepBase {
  readonly type: "command";
  readonly command: string;
  readonly waitForCompletion?: boolean;
}

export type GuidedFlowStepDefinition =
  | GuidedFlowViewStepDefinition
  | GuidedFlowNestedStepDefinition
  | GuidedFlowCommandStepDefinition;

export interface GuidedFlowDefinition {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly source?: {
    readonly type: "request-blueprint";
    readonly id: string;
    readonly version: number;
  };
  readonly steps: readonly GuidedFlowStepDefinition[];
  readonly completionRouteId?: string;
  readonly completionRouteParameters?: Readonly<Record<string, string>>;
  readonly controls?: readonly GuidedFlowControlId[];
  readonly onComplete?: {
    readonly action: "agency-request.submit";
  };
}

export interface GuidedFlowFrame {
  readonly flowId: string;
  readonly flowVersion: number;
  readonly currentStepId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly backStack: readonly string[];
}

export interface GuidedFlowInstance {
  readonly instanceId: string;
  readonly instanceKey?: string;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly currentStepId: string;
  readonly status: GuidedFlowStatus;
  readonly revision: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly output: Readonly<Record<string, unknown>>;
  readonly backStack: readonly string[];
  readonly stack: readonly GuidedFlowFrame[];
}

export interface GuidedFlowSubmit {
  readonly actionId: string;
  readonly result?: Readonly<Record<string, unknown>>;
}
