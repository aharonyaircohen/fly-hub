export type EngineSetupFileStatus = "present" | "missing" | "unknown";

export interface EngineSetupFileStatuses {
  workflow: EngineSetupFileStatus;
  config: EngineSetupFileStatus;
}

export type EngineSetupStatus =
  | {
      status: "ready" | "setup_required";
      files: EngineSetupFileStatuses;
    }
  | {
      status: "unknown";
      files: EngineSetupFileStatuses;
      error: "github_access_failed";
    };
