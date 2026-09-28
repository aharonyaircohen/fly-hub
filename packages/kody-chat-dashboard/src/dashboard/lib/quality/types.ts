import type {
  QualityAction,
  QualityJourney,
  QualityRunStatus,
  QualityRunUsage,
  QualityScenario,
} from "./contracts";

export type QualityRun = {
  runId: string;
  runSlug: string;
  journeySlugs: string[];
  scenarioSlug: string;
  environment: string;
  targetUrl: string;
  sourceCommit: string;
  definitionUpdatedAt: string;
  retryOfRunId?: string;
  status: QualityRunStatus;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  latestEvent?: {
    type?: string;
    summary?: string;
    artifactPath?: string;
    artifactUrl?: string;
    passed?: number;
    failed?: number;
    blocked?: number;
    usage?: QualityRunUsage;
    journeyResults?: Array<{
      journeySlug: string;
      journeyName: string;
      status: "passed" | "failed" | "blocked";
      evidence: string;
      issueSource?: "none" | "product" | "test" | "environment" | "unknown";
      cause?: string;
      correction?: string;
      artifactPath: string;
    }>;
    actionResults?: Array<{
      journeySlug?: string;
      actionSlug: string;
      actionName: string;
      status: "passed" | "failed" | "blocked";
      evidence: string;
      issueSource?: "none" | "product" | "test" | "environment" | "unknown";
      cause?: string;
      correction?: string;
      artifactPath: string;
    }>;
    scenarioResult?: {
      status: "passed" | "failed" | "blocked";
      evidence: string;
      issueSource?: "none" | "product" | "test" | "environment" | "unknown";
      cause?: string;
      correction?: string;
      artifactPath: string;
    };
  };
};

export type QualityMap = {
  actions: QualityAction[];
  journeys: QualityJourney[];
  scenarios: QualityScenario[];
  runs: QualityRun[];
  currentSourceCommit: string | null;
  environments: Array<{ id: string; label: string; url?: string }>;
};

export type QualityResource = "actions" | "journeys" | "scenarios" | "runs";
export type QualityRecord =
  QualityAction | QualityJourney | QualityScenario | QualityRun;
