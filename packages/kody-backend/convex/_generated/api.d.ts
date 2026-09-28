/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actionStates from "../actionStates.js";
import type * as agencyModel from "../agencyModel.js";
import type * as agencyRecords from "../agencyRecords.js";
import type * as agencyRequestLoops from "../agencyRequestLoops.js";
import type * as agencyRuns from "../agencyRuns.js";
import type * as agencyValidators from "../agencyValidators.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agentStates from "../agentStates.js";
import type * as agents from "../agents.js";
import type * as appDeployments from "../appDeployments.js";
import type * as appEvents from "../appEvents.js";
import type * as apps from "../apps.js";
import type * as auth from "../auth.js";
import type * as betterAuth_auth from "../betterAuth/auth.js";
import type * as betterAuth_trustedOrigins from "../betterAuth/trustedOrigins.js";
import type * as blueprintInstallations from "../blueprintInstallations.js";
import type * as brainRestoreJobs from "../brainRestoreJobs.js";
import type * as browserSessions from "../browserSessions.js";
import type * as capabilityState from "../capabilityState.js";
import type * as catalog from "../catalog.js";
import type * as channelsSeen from "../channelsSeen.js";
import type * as chatEvents from "../chatEvents.js";
import type * as clientLaunchNonces from "../clientLaunchNonces.js";
import type * as clientLaunchRateLimits from "../clientLaunchRateLimits.js";
import type * as connections from "../connections.js";
import type * as conversationTurns from "../conversationTurns.js";
import type * as conversationValidators from "../conversationValidators.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as dailyLogs from "../dailyLogs.js";
import type * as definitionProposals from "../definitionProposals.js";
import type * as definitions from "../definitions.js";
import type * as eventLog from "../eventLog.js";
import type * as guidedFlows from "../guidedFlows.js";
import type * as http from "../http.js";
import type * as importExport from "../importExport.js";
import type * as inbox from "../inbox.js";
import type * as intents from "../intents.js";
import type * as lib_auth from "../lib/auth.js";
import type * as loopWakes from "../loopWakes.js";
import type * as macros from "../macros.js";
import type * as manifests from "../manifests.js";
import type * as mcpAccessTokens from "../mcpAccessTokens.js";
import type * as mcpApprovalRequests from "../mcpApprovalRequests.js";
import type * as mcpAuditEvents from "../mcpAuditEvents.js";
import type * as mcpRateLimits from "../mcpRateLimits.js";
import type * as memories from "../memories.js";
import type * as memoryLearning from "../memoryLearning.js";
import type * as memoryValidators from "../memoryValidators.js";
import type * as notificationPrefs from "../notificationPrefs.js";
import type * as pipelineRuns from "../pipelineRuns.js";
import type * as pipelines from "../pipelines.js";
import type * as qaUserProvisioning from "../qaUserProvisioning.js";
import type * as quality from "../quality.js";
import type * as repoDocs from "../repoDocs.js";
import type * as reports from "../reports.js";
import type * as repositoryPreferences from "../repositoryPreferences.js";
import type * as runEvents from "../runEvents.js";
import type * as taskState from "../taskState.js";
import type * as userCredentials from "../userCredentials.js";
import type * as userJourneys from "../userJourneys.js";
import type * as userPreferences from "../userPreferences.js";
import type * as userState from "../userState.js";
import type * as validators from "../validators.js";
import type * as viewRenderers from "../viewRenderers.js";
import type * as widgets from "../widgets.js";
import type * as workflowEventDeliveries from "../workflowEventDeliveries.js";
import type * as workflowRunLeases from "../workflowRunLeases.js";
import type * as workflowRuns from "../workflowRuns.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actionStates: typeof actionStates;
  agencyModel: typeof agencyModel;
  agencyRecords: typeof agencyRecords;
  agencyRequestLoops: typeof agencyRequestLoops;
  agencyRuns: typeof agencyRuns;
  agencyValidators: typeof agencyValidators;
  agentRuns: typeof agentRuns;
  agentStates: typeof agentStates;
  agents: typeof agents;
  appDeployments: typeof appDeployments;
  appEvents: typeof appEvents;
  apps: typeof apps;
  auth: typeof auth;
  "betterAuth/auth": typeof betterAuth_auth;
  "betterAuth/trustedOrigins": typeof betterAuth_trustedOrigins;
  blueprintInstallations: typeof blueprintInstallations;
  brainRestoreJobs: typeof brainRestoreJobs;
  browserSessions: typeof browserSessions;
  capabilityState: typeof capabilityState;
  catalog: typeof catalog;
  channelsSeen: typeof channelsSeen;
  chatEvents: typeof chatEvents;
  clientLaunchNonces: typeof clientLaunchNonces;
  clientLaunchRateLimits: typeof clientLaunchRateLimits;
  connections: typeof connections;
  conversationTurns: typeof conversationTurns;
  conversationValidators: typeof conversationValidators;
  conversations: typeof conversations;
  crons: typeof crons;
  dailyLogs: typeof dailyLogs;
  definitionProposals: typeof definitionProposals;
  definitions: typeof definitions;
  eventLog: typeof eventLog;
  guidedFlows: typeof guidedFlows;
  http: typeof http;
  importExport: typeof importExport;
  inbox: typeof inbox;
  intents: typeof intents;
  "lib/auth": typeof lib_auth;
  loopWakes: typeof loopWakes;
  macros: typeof macros;
  manifests: typeof manifests;
  mcpAccessTokens: typeof mcpAccessTokens;
  mcpApprovalRequests: typeof mcpApprovalRequests;
  mcpAuditEvents: typeof mcpAuditEvents;
  mcpRateLimits: typeof mcpRateLimits;
  memories: typeof memories;
  memoryLearning: typeof memoryLearning;
  memoryValidators: typeof memoryValidators;
  notificationPrefs: typeof notificationPrefs;
  pipelineRuns: typeof pipelineRuns;
  pipelines: typeof pipelines;
  qaUserProvisioning: typeof qaUserProvisioning;
  quality: typeof quality;
  repoDocs: typeof repoDocs;
  reports: typeof reports;
  repositoryPreferences: typeof repositoryPreferences;
  runEvents: typeof runEvents;
  taskState: typeof taskState;
  userCredentials: typeof userCredentials;
  userJourneys: typeof userJourneys;
  userPreferences: typeof userPreferences;
  userState: typeof userState;
  validators: typeof validators;
  viewRenderers: typeof viewRenderers;
  widgets: typeof widgets;
  workflowEventDeliveries: typeof workflowEventDeliveries;
  workflowRunLeases: typeof workflowRunLeases;
  workflowRuns: typeof workflowRuns;
  workflows: typeof workflows;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
