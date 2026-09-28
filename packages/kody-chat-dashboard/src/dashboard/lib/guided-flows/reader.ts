import type {
  GuidedFlowDefinition,
  GuidedFlowFrame,
  GuidedFlowInstance,
  GuidedFlowStepDefinition,
} from "./controller";
import type { GuidedFlowSubmissionPage } from "./submission";

export interface GuidedFlowBinding {
  readonly conversationId: string;
  readonly instanceId: string;
}

export interface GuidedFlowRef {
  readonly flowId: string;
  readonly flowVersion: number;
}

export interface GuidedFlowCurrent {
  readonly binding: GuidedFlowBinding;
  readonly instance: GuidedFlowInstance;
  readonly definition: GuidedFlowDefinition;
  readonly currentStep: GuidedFlowStepDefinition;
  readonly path: readonly GuidedFlowFrame[];
}

export interface GuidedFlowReader {
  getCurrent(): Promise<GuidedFlowCurrent | null>;
  getOutline(): Promise<readonly GuidedFlowDefinition[]>;
  getStep(
    reference: GuidedFlowRef & { readonly stepId: string },
  ): Promise<GuidedFlowStepDefinition | null>;
  getData(keys?: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  getHistory(options?: {
    readonly beforeRevision?: number;
    readonly limit?: number;
  }): Promise<GuidedFlowSubmissionPage>;
  getModelGuides(
    definitions: readonly GuidedFlowDefinition[],
  ): Promise<readonly string[]>;
}
