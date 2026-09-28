import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  getGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
} from "@kody-ade/kody-chat-dashboard/guided-flows/controller";
import { guidedFlowDefinitionForReference } from "@kody-ade/kody-chat-dashboard/guided-flows/definitions";
import { getRequestBlueprintDefinition } from "@kody-ade/kody-chat-dashboard/guided-flows/registry";
import { buildRequestBlueprintModelGuide } from "@kody-ade/kody-chat-dashboard/request-blueprints";
import {
  guidedFlowInstanceFromRow,
  type GuidedFlowStoredInstance,
} from "@kody-ade/kody-chat-dashboard/guided-flows/persistence";
import {
  type GuidedFlowCurrent,
  type GuidedFlowReader,
  type GuidedFlowRef,
} from "@kody-ade/kody-chat-dashboard/guided-flows/reader";
import {
  type GuidedFlowSubmission,
  type GuidedFlowSubmissionPage,
} from "@kody-ade/kody-chat-dashboard/guided-flows/submission";
import { type StoredGuidedFlowDefinition } from "@kody-ade/kody-chat-dashboard/guided-flows/stored";
import { loadStoredGuidedFlowDefinitions } from "./catalog";

interface GuidedFlowReaderContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly conversationId: string;
}

interface GuidedFlowBindingRow {
  readonly conversationId: string;
  readonly instanceId: string;
}

type GuidedFlowInstanceRow = GuidedFlowStoredInstance;

interface GuidedFlowSubmissionRow {
  readonly instanceId: string;
  readonly revision: number;
  readonly flowId: string;
  readonly flowVersion: number;
  readonly stepId: string;
  readonly actionId: string;
  readonly result: unknown;
  readonly submittedAt: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function submissionFromRow(row: GuidedFlowSubmissionRow): GuidedFlowSubmission {
  return { ...row, result: record(row.result) };
}

export class ConvexGuidedFlowReader implements GuidedFlowReader {
  readonly #client = createBackendClient();
  readonly #context: GuidedFlowReaderContext;

  constructor(context: GuidedFlowReaderContext) {
    this.#context = context;
  }

  async #definitions(): Promise<readonly StoredGuidedFlowDefinition[]> {
    return await loadStoredGuidedFlowDefinitions(
      this.#client,
      this.#context.tenantId,
    );
  }

  async #binding(): Promise<GuidedFlowBindingRow | null> {
    return (await this.#client.query(
      backendApi.guidedFlows.getConversationBinding,
      this.#context,
    )) as GuidedFlowBindingRow | null;
  }

  async getCurrent(): Promise<GuidedFlowCurrent | null> {
    const binding = await this.#binding();
    if (!binding) return null;
    const row = (await this.#client.query(backendApi.guidedFlows.get, {
      tenantId: this.#context.tenantId,
      actorId: this.#context.actorId,
      instanceId: binding.instanceId,
    })) as GuidedFlowInstanceRow | null;
    if (!row) return null;

    const instance = guidedFlowInstanceFromRow(row);
    const definition = guidedFlowDefinitionForReference(
      instance.flowId,
      instance.flowVersion,
      await this.#definitions(),
    );
    if (!definition) return null;
    return {
      binding,
      instance,
      definition,
      currentStep: getGuidedFlowStep(definition, instance),
      path: [...instance.stack],
    };
  }

  async getOutline(): Promise<readonly GuidedFlowDefinition[]> {
    const current = await this.getCurrent();
    if (!current) return [];
    const customDefinitions = await this.#definitions();
    const definitions: GuidedFlowDefinition[] = [];
    const seen = new Set<string>();
    const visit = (definition: GuidedFlowDefinition): void => {
      const key = `${definition.id}@${definition.version}`;
      if (seen.has(key)) return;
      seen.add(key);
      definitions.push(definition);
      for (const step of definition.steps) {
        if (!isNestedGuidedFlowStep(step)) continue;
        const child = guidedFlowDefinitionForReference(
          step.flowId,
          step.flowVersion,
          customDefinitions,
        );
        if (child) visit(child);
      }
    };
    const rootFrame = current.instance.stack[0];
    const root = rootFrame
      ? guidedFlowDefinitionForReference(
          rootFrame.flowId,
          rootFrame.flowVersion,
          customDefinitions,
        )
      : current.definition;
    if (root) visit(root);
    return definitions;
  }

  async getModelGuides(
    definitions: readonly GuidedFlowDefinition[],
  ): Promise<readonly string[]> {
    return definitions.flatMap((definition) => {
      const source = definition.source;
      const blueprint = source
        ? getRequestBlueprintDefinition(source.id, source.version)
        : null;
      return blueprint
        ? [buildRequestBlueprintModelGuide(blueprint)]
        : [];
    });
  }

  async getStep(reference: GuidedFlowRef & { readonly stepId: string }) {
    const definitions = await this.getOutline();
    return (
      definitions
        .find(
          (definition) =>
            definition.id === reference.flowId &&
            definition.version === reference.flowVersion,
        )
        ?.steps.find((step) => step.id === reference.stepId) ?? null
    );
  }

  async getData(
    keys?: readonly string[],
  ): Promise<Readonly<Record<string, unknown>>> {
    const current = await this.getCurrent();
    if (!current) return {};
    if (!keys?.length) return current.instance.data;
    return Object.fromEntries(
      keys.flatMap((key) =>
        Object.hasOwn(current.instance.data, key)
          ? [[key, current.instance.data[key]]]
          : [],
      ),
    );
  }

  async getHistory(options?: {
    readonly beforeRevision?: number;
    readonly limit?: number;
  }): Promise<GuidedFlowSubmissionPage> {
    const binding = await this.#binding();
    if (!binding) return { items: [] };
    const rows = (await this.#client.query(
      backendApi.guidedFlows.listSubmissions,
      {
        tenantId: this.#context.tenantId,
        actorId: this.#context.actorId,
        instanceId: binding.instanceId,
        ...(options?.beforeRevision === undefined
          ? {}
          : { beforeRevision: options.beforeRevision }),
        limit: options?.limit ?? 20,
      },
    )) as GuidedFlowSubmissionRow[];
    const items = rows.map(submissionFromRow);
    return {
      items,
      ...(items.length === (options?.limit ?? 20)
        ? { nextBeforeRevision: items.at(-1)?.revision }
        : {}),
    };
  }
}
