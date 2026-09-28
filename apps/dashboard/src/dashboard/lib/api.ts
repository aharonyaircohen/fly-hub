/**
 * @fileType utility
 * @domain kody
 * @pattern api-client
 * @ai-summary Typed API client for Kody dashboard — barrel over the
 * per-feature modules in ./api/. Core transport lives in ./api/client.
 */

export * from "./api/client";
export * from "./api/tasks";
export * from "./api/prs";
export * from "./api/repo";
export * from "./api/workflow-definitions";
export * from "./api/remote";
export * from "./api/capabilities";
export * from "./api/agents";
export * from "./api/context";
export * from "./api/todos";
export * from "./api/memory";
export * from "./api/reports";
export * from "./api/notifications";
export * from "./api/changelog";
export * from "./api/vibe";
export * from "./api/cto";
export * from "./api/activity";
export * from "./api/messages";
export * from "./api/bugs";
export * from "./api/company";
export * from "./api/jobs";

import { tasksApi, taskDocsApi } from "./api/tasks";
import { prsApi } from "./api/prs";
import { boardsApi, collaboratorsApi, workflowsApi, ciApi } from "./api/repo";
import { workflowDefinitionsApi } from "./api/workflow-definitions";
import { remoteApi } from "./api/remote";
import { capabilitiesApi } from "./api/capabilities";
import { staffApi } from "./api/agents";
import { contextApi } from "./api/context";
import { todosApi } from "./api/todos";
import { memoryApi } from "./api/memory";
import { reportsApi } from "./api/reports";
import { notificationsApi } from "./api/notifications";
import { changelogApi } from "./api/changelog";
import { vibeApi } from "./api/vibe";
import { ctoApi } from "./api/cto";
import { activityApi, agencyRunsApi } from "./api/activity";
import { messagesApi } from "./api/messages";
import { kodyBugsApi } from "./api/bugs";
import { companyApi } from "./api/company";
import { jobsApi } from "./api/jobs";

// ============ Combined API ============

export const kodyApi = {
  jobs: jobsApi,
  tasks: tasksApi,
  prs: prsApi,
  taskDocs: taskDocsApi,
  boards: boardsApi,
  collaborators: collaboratorsApi,
  workflows: workflowsApi,
  workflowDefinitions: workflowDefinitionsApi,
  ci: ciApi,
  remote: remoteApi,
  capabilities: capabilitiesApi,
  agent: staffApi,
  context: contextApi,
  todos: todosApi,
  memory: memoryApi,
  company: companyApi,
  reports: reportsApi,
  messages: messagesApi,
  notifications: notificationsApi,
  changelog: changelogApi,
  vibe: vibeApi,
  cto: ctoApi,
  activity: activityApi,
  agencyRuns: agencyRunsApi,
  kodyBugs: kodyBugsApi,
};
