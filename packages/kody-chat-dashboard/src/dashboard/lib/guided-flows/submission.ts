export interface GuidedFlowSubmission {
  readonly instanceId: string;
  readonly revision: number;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly stepId: string;
  readonly actionId: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly submittedAt: string;
}

export interface GuidedFlowSubmissionPage {
  readonly items: readonly GuidedFlowSubmission[];
  readonly nextBeforeRevision?: number;
}
