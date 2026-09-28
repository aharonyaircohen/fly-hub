/** @fileType page */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Loader2,
  Pencil,
  Play,
  Plus,
  Route,
  Trash2,
} from "lucide-react";
import { repoScopedHref } from "@kody-ade/base/routes";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { DASHBOARD_NAVIGATION_TARGETS } from "../dashboard-navigation";
import {
  listAuthoringRendererSlugs,
  buildGuidedFlowDefinition,
  validateGuidedFlowDraft,
  type GuidedFlowDraft,
  type GuidedFlowDraftStep,
  type GuidedFlowDraftViewStep,
} from "../guided-flows/authoring";
import { listGuidedFlowDefinitions } from "../guided-flows/registry";
import {
  isCommandGuidedFlowStep,
  isNestedGuidedFlowStep,
  type GuidedFlowDefinition,
} from "../guided-flows/controller";
import { getBuiltinViewRendererDefinition } from "../view-renderers/builtin";
import { isWidgetViewRenderer } from "../view-renderers/classification";
import type { ViewRendererDefinition } from "../view-renderers/definition";
import { buildRenderedViewDirective } from "../view-renderers/template";
import { RenderedViewCard } from "../chat/surface/RenderedViewCard";
import type { RenderedViewDirective } from "../chat-ui-actions";
import { Button } from "@kody-ade/base/ui/button";
import { Card, CardContent } from "@kody-ade/base/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@kody-ade/base/ui/dialog";
import { PageShell } from "../components/PageShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MarkdownEditor } from "../components/MarkdownEditor";
import {
  useGuidedFlowChat,
  type GuidedFlowSourceScope,
} from "../guided-flows/chat-controller";
import { resolveCmsItemsSource } from "../guided-flows/cms-items";
import { guidedFlowRequestAuth } from "../guided-flows/page-scope";
import { WidgetStepFields } from "../guided-flows/WidgetStepFields";

type FlowDefinition = GuidedFlowDefinition & { description?: string };

const BUILTIN_START_OPTIONS: FlowDefinition[] = [
  ...listGuidedFlowDefinitions(),
];

function isBuiltinDefinition(definition: FlowDefinition): boolean {
  return BUILTIN_START_OPTIONS.some(
    (candidate) => candidate.id === definition.id,
  );
}

function isReadOnlyDefinition(definition: FlowDefinition): boolean {
  return isBuiltinDefinition(definition) || Boolean(definition.source);
}

const RENDERER_LABELS: Record<string, string> = {
  "approval-card": "Approval card",
  "guided-form": "Guided form",
  "selection-list": "Selection list",
  "multi-select-list": "Multi-select list",
};

function DashboardPageFields({
  ariaLabel,
  visibleLabel,
  routeId,
  routeParameters,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  visibleLabel: string;
  routeId: string;
  routeParameters: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange: (
    routeId: string,
    routeParameters: Readonly<Record<string, string>>,
  ) => void;
}) {
  const selectedTarget = DASHBOARD_NAVIGATION_TARGETS.find(
    (target) => target.routeId === routeId,
  );
  const isLegacyRoute = Boolean(routeId) && !selectedTarget;

  return (
    <div className="text-sm text-white/70">
      <label>
        {visibleLabel}
        <select
          aria-label={ariaLabel}
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
          value={routeId}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, {})}
        >
          <option value="">No page</option>
          {isLegacyRoute ? (
            <option value={routeId}>Previously selected page</option>
          ) : null}
          {DASHBOARD_NAVIGATION_TARGETS.map((target) => (
            <option key={target.routeId} value={target.routeId}>
              {target.label}
            </option>
          ))}
        </select>
      </label>
      {selectedTarget?.parameters?.map((parameter) => (
        <label key={parameter.key} className="mt-2 block">
          {parameter.label}
          <input
            aria-label={`${ariaLabel} ${parameter.label}`}
            type={parameter.type === "positive-integer" ? "number" : "text"}
            inputMode={
              parameter.type === "positive-integer" ? "numeric" : undefined
            }
            min={parameter.type === "positive-integer" ? 1 : undefined}
            placeholder={parameter.placeholder}
            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
            value={routeParameters[parameter.key] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(routeId, {
                ...routeParameters,
                [parameter.key]: event.target.value,
              })
            }
          />
        </label>
      ))}
    </div>
  );
}

function newDraftStep(): GuidedFlowDraftStep {
  return {
    title: "New step",
    explanation: "Explain what the user should do next.",
    rendererSlug: "guided-form",
  };
}

function guidedFormPrimaryField(step: GuidedFlowDraftViewStep): {
  name: string;
  label: string;
  value: string;
  inputType?: string;
} {
  const fields = Array.isArray(step.rendererData?.fields)
    ? step.rendererData.fields
    : [];
  const first = fields[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const field = first as Record<string, unknown>;
    return {
      name: typeof field.name === "string" ? field.name : "response",
      label: typeof field.label === "string" ? field.label : "Your response",
      value: typeof field.value === "string" ? field.value : "",
      ...(typeof field.inputType === "string"
        ? { inputType: field.inputType }
        : {}),
    };
  }
  return { name: "response", label: "Your response", value: "" };
}

function withGuidedFormPrimaryField(
  step: GuidedFlowDraftViewStep,
  patch: Readonly<{ name?: string; label?: string }>,
): GuidedFlowDraftViewStep {
  const fields = Array.isArray(step.rendererData?.fields)
    ? step.rendererData.fields
    : [];
  const primary = guidedFormPrimaryField(step);
  return {
    ...step,
    rendererData: {
      ...(step.rendererData ?? {}),
      fields: [{ ...primary, ...patch }, ...fields.slice(1)],
    },
  };
}

function draftFromDefinition(definition: FlowDefinition): GuidedFlowDraft {
  return {
    title: definition.title,
    completionRouteId: definition.completionRouteId ?? "",
    completionRouteParameters: definition.completionRouteParameters ?? {},
    controls: [...(definition.controls ?? [])],
    steps: definition.steps.map((step) =>
      isNestedGuidedFlowStep(step)
        ? {
            type: "flow",
            title: step.title,
            explanation: step.explanation,
            routeId: step.routeId,
            routeParameters: step.routeParameters,
            flowId: step.flowId,
            flowVersion: step.flowVersion,
          }
        : isCommandGuidedFlowStep(step)
          ? {
              type: "command",
              title: step.title,
              explanation: step.explanation,
              routeId: step.routeId,
              routeParameters: step.routeParameters,
              command: step.command,
              waitForCompletion: step.waitForCompletion,
            }
          : {
              title: step.title ?? definition.title,
              explanation:
                step.explanation ??
                (typeof step.rendererData?.body === "string"
                  ? step.rendererData.body
                  : "Explain what the user should do next."),
              rendererSlug: step.rendererSlug,
              routeId: step.routeId,
              routeParameters: step.routeParameters,
              rendererVersion: step.rendererVersion,
              itemsSource: step.itemsSource,
              filePicker: step.filePicker
                ? {
                    resultField: step.filePicker.resultField,
                    ...(step.filePicker.extensions
                      ? { extensions: [...step.filePicker.extensions] }
                      : {}),
                  }
                : undefined,
              ...(listAuthoringRendererSlugs().includes(step.rendererSlug)
                ? { rendererData: step.rendererData }
                : {
                    rendererDataJson: JSON.stringify(
                      step.rendererData ?? {},
                      null,
                      2,
                    ),
                    completionActionId: step.actions[0]?.id ?? "complete",
                  }),
            },
    ),
  };
}

function previewForDraft(
  draft: GuidedFlowDraft,
  selectedStepIndex: number,
  customRenderers: Readonly<Record<string, ViewRendererDefinition>> = {},
): RenderedViewDirective | null {
  try {
    const definition = buildGuidedFlowDefinition({
      ...draft,
      title: draft.title.trim() || "Preview",
      steps: draft.steps.map((step) => ({
        ...step,
        title: step.title.trim() || "Untitled step",
        explanation:
          step.explanation.trim() || "Add instructions for this step.",
      })),
    });
    const step = definition.steps[selectedStepIndex] ?? definition.steps[0];
    if (!step || isNestedGuidedFlowStep(step)) return null;
    if (isCommandGuidedFlowStep(step)) {
      const renderer = getBuiltinViewRendererDefinition("guided-flow-command");
      if (!renderer) return null;
      return buildRenderedViewDirective({
        id: `guided-flow-preview-${selectedStepIndex}`,
        definition: renderer,
        data: {
          title: step.title,
          body: step.explanation,
          command: step.command,
          status: "ready",
          summary: "Ready to run.",
          actions: [
            {
              id: "run",
              label: "Run command",
              response: "run",
              variant: "primary",
            },
          ],
        },
      });
    }
    const renderer = step
      ? (customRenderers[`${step.rendererSlug}@${step.rendererVersion}`] ??
        customRenderers[step.rendererSlug] ??
        getBuiltinViewRendererDefinition(step.rendererSlug))
      : null;
    if (!renderer) return null;
    const view = buildRenderedViewDirective({
      id: `guided-flow-preview-${selectedStepIndex}`,
      definition: renderer,
      data: step.rendererData ?? {},
    });
    return step.itemsSource
      ? { ...view, dataSource: resolveCmsItemsSource(step.itemsSource, {}) }
      : view;
  } catch {
    return null;
  }
}

function FlowBuilder({
  mode,
  definition,
  flowOptions,
  onSaved,
  onClose,
  requestAuth,
}: {
  mode: "create" | "edit" | "view";
  definition?: FlowDefinition;
  flowOptions: readonly FlowDefinition[];
  onSaved: (definition: FlowDefinition) => void;
  onClose: () => void;
  requestAuth: ReturnType<typeof useAuth>["auth"];
}) {
  const [draft, setDraft] = useState<GuidedFlowDraft>({
    ...(definition
      ? draftFromDefinition(definition)
      : {
          title: "",
          completionRouteId: "",
          controls: [],
          steps: [newDraftStep()],
        }),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendererCatalog, setRendererCatalog] = useState<
    ViewRendererDefinition[]
  >([]);
  const [rendererCatalogError, setRendererCatalogError] = useState<
    string | null
  >(null);
  const readOnly = mode === "view";
  const nestedFlowOptions = useMemo(
    () => flowOptions.filter((candidate) => candidate.id !== definition?.id),
    [definition?.id, flowOptions],
  );
  const widgetRenderers = useMemo(
    () => rendererCatalog.filter(isWidgetViewRenderer),
    [rendererCatalog],
  );
  const customRenderers = useMemo(
    () =>
      Object.fromEntries(
        rendererCatalog.flatMap((renderer) => [
          [renderer.slug, renderer],
          [`${renderer.slug}@${renderer.version ?? 1}`, renderer],
        ]),
      ),
    [rendererCatalog],
  );

  useEffect(() => {
    const controller = new AbortController();
    setRendererCatalogError(null);
    void fetch("/api/kody/view-renderers", {
      headers: buildAuthHeaders(requestAuth),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          renderers?: ViewRendererDefinition[];
          message?: string;
          error?: string;
        };
        if (!response.ok || !payload.renderers) {
          throw new Error(
            payload.message ?? payload.error ?? "Unable to load widgets",
          );
        }
        setRendererCatalog(payload.renderers);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRendererCatalogError(
          cause instanceof Error ? cause.message : "Unable to load widgets",
        );
      });
    return () => controller.abort();
  }, [requestAuth]);

  function updateStep(
    index: number,
    update: (step: GuidedFlowDraftStep) => GuidedFlowDraftStep,
  ) {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) =>
        stepIndex === index ? update(step) : step,
      ),
    }));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
    setDraft((current) => {
      const steps = [...current.steps];
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      return { ...current, steps };
    });
  }

  function duplicateStep(index: number) {
    const copy = {
      ...draft.steps[index],
      title: `${draft.steps[index].title} (copy)`,
    };
    setDraft((current) => ({
      ...current,
      steps: [
        ...current.steps.slice(0, index + 1),
        copy,
        ...current.steps.slice(index + 1),
      ],
    }));
  }

  function deleteStep(index: number) {
    if (draft.steps.length <= 1) return;
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  }

  async function save() {
    const validationErrors = validateGuidedFlowDraft(draft);
    if (Object.keys(validationErrors).length > 0) {
      setError(Object.values(validationErrors)[0]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/kody/guided-flows", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(requestAuth),
        },
        body: JSON.stringify({
          action: mode === "edit" ? "update-definition" : "create-definition",
          ...(mode === "edit" && definition ? { flowId: definition.id } : {}),
          draft,
        }),
      });
      const payload = (await response.json()) as {
        definition?: FlowDefinition;
        error?: string;
      };
      if (!response.ok || !payload.definition) {
        throw new Error(payload.error ?? "Unable to save Guided Flow");
      }
      onSaved(payload.definition);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save Guided Flow",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent modalSize="wide" className="items-start">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "Create a Guided Flow"
              : mode === "edit"
                ? "Edit Guided Flow"
                : "View Guided Flow"}
          </DialogTitle>
          <DialogDescription>
            Define the steps the user follows.
            {definition
              ? ` Editing creates a new version; existing runs stay on v${definition.version ?? 1}.`
              : " This flow will be saved as version 1."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-200">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70">
            Flow name
            <input
              aria-label="Flow name"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
              value={draft.title}
              disabled={readOnly}
              aria-invalid={Boolean(error && !draft.title.trim())}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </label>
          <DashboardPageFields
            ariaLabel="Completion page"
            visibleLabel="Completion page (optional)"
            routeId={draft.completionRouteId ?? ""}
            routeParameters={draft.completionRouteParameters ?? {}}
            disabled={readOnly}
            onChange={(completionRouteId, completionRouteParameters) =>
              setDraft((current) => ({
                ...current,
                completionRouteId,
                completionRouteParameters,
              }))
            }
          />
        </div>
        <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
          <label className="flex items-center gap-3 text-sm text-white/80">
            <input
              type="checkbox"
              aria-label="Enable Back control"
              checked={draft.controls?.includes("back") ?? false}
              disabled={readOnly}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  controls: event.target.checked ? ["back"] : [],
                }))
              }
            />
            Allow users to return to the previous step
          </label>
        </div>
        <div className="mt-5 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-white/80">Steps</h3>
            <span className="text-xs text-white/50">
              {draft.steps.length} total
            </span>
          </div>
          {draft.steps.map((step, index) => {
            const stepPreview = previewForDraft(draft, index, customRenderers);
            const widgetStep =
              step.type !== "flow" &&
              step.type !== "command" &&
              widgetRenderers.some(
                (renderer) => renderer.slug === step.rendererSlug,
              );
            return (
              <article
                key={index}
                aria-label={`Step ${index + 1}: ${step.title || "Untitled step"}`}
                className="rounded-xl border border-white/10 bg-black/20 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] lg:gap-x-5"
              >
                <div className="mb-3 flex items-start justify-between gap-3 lg:col-start-1">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white/90">
                        {step.title || "Untitled step"}
                      </p>
                    </div>
                  </div>
                  {!readOnly ? (
                    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={index === draft.steps.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={`Duplicate step ${index + 1}`}
                        onClick={() => duplicateStep(index)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {draft.steps.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Delete step ${index + 1}`}
                          onClick={() => deleteStep(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <div className="lg:col-start-1">
                  <section aria-label={`Step form ${index + 1}`}>
                    <div className="space-y-5">
                      <section>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <input
                            aria-label={`Step ${index + 1} title`}
                            placeholder="Step title"
                            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                            value={step.title}
                            disabled={readOnly}
                            onChange={(event) =>
                              updateStep(index, (current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                          />
                          <select
                            aria-label={`Step ${index + 1} type`}
                            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                            value={
                              widgetStep ? "widget" : (step.type ?? "view")
                            }
                            disabled={readOnly}
                            onChange={(event) => {
                              updateStep(index, (current) =>
                                event.target.value === "flow"
                                  ? (() => {
                                      const selected = nestedFlowOptions[0];
                                      return {
                                        type: "flow" as const,
                                        title: current.title,
                                        explanation: current.explanation,
                                        routeId: current.routeId,
                                        routeParameters:
                                          current.routeParameters,
                                        flowId: selected?.id ?? "",
                                        flowVersion: selected?.version ?? 1,
                                      };
                                    })()
                                  : event.target.value === "command"
                                    ? {
                                        type: "command",
                                        title: current.title,
                                        explanation: current.explanation,
                                        routeId: current.routeId,
                                        routeParameters:
                                          current.routeParameters,
                                        command: "/init",
                                      }
                                    : event.target.value === "widget"
                                      ? (() => {
                                          const renderer = widgetRenderers[0];
                                          return renderer
                                            ? {
                                                title: current.title,
                                                explanation:
                                                  current.explanation,
                                                routeId: current.routeId,
                                                routeParameters:
                                                  current.routeParameters,
                                                rendererSlug: renderer.slug,
                                                rendererVersion:
                                                  renderer.version ?? 1,
                                                rendererDataJson: "{}",
                                                completionActionId: "complete",
                                              }
                                            : current;
                                        })()
                                      : {
                                          title: current.title,
                                          explanation: current.explanation,
                                          routeId: current.routeId,
                                          routeParameters:
                                            current.routeParameters,
                                          rendererSlug: "guided-form",
                                        },
                              );
                            }}
                          >
                            <option value="view">View</option>
                            <option
                              value="widget"
                              disabled={widgetRenderers.length === 0}
                            >
                              {widgetRenderers.length > 0
                                ? "Widget"
                                : "Widget (none available)"}
                            </option>
                            <option value="command">Command</option>
                            <option value="flow">Nested flow</option>
                          </select>
                        </div>
                        {step.type === "flow" ? (
                          <label className="mt-3 block text-sm text-white/70">
                            Flow
                            <select
                              aria-label={`Step ${index + 1} nested flow`}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                              value={`${step.flowId}@${step.flowVersion}`}
                              disabled={
                                readOnly || nestedFlowOptions.length === 0
                              }
                              onChange={(event) => {
                                const selected = nestedFlowOptions.find(
                                  (candidate) =>
                                    `${candidate.id}@${candidate.version}` ===
                                    event.target.value,
                                );
                                if (!selected) return;
                                updateStep(index, (current) =>
                                  current.type === "flow"
                                    ? {
                                        ...current,
                                        flowId: selected.id,
                                        flowVersion: selected.version,
                                      }
                                    : current,
                                );
                              }}
                            >
                              {!nestedFlowOptions.some(
                                (candidate) =>
                                  candidate.id === step.flowId &&
                                  candidate.version === step.flowVersion,
                              ) ? (
                                <option
                                  value={`${step.flowId}@${step.flowVersion}`}
                                  disabled
                                >
                                  {step.flowId
                                    ? "Previously selected flow"
                                    : "No flows available"}
                                </option>
                              ) : null}
                              {nestedFlowOptions.map((candidate) => (
                                <option
                                  key={`${candidate.id}@${candidate.version}`}
                                  value={`${candidate.id}@${candidate.version}`}
                                >
                                  {candidate.title} · v{candidate.version}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : step.type === "command" ? (
                          <div className="mt-3 space-y-3">
                            <input
                              aria-label={`Step ${index + 1} command`}
                              placeholder="/init"
                              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                              value={step.command}
                              disabled={readOnly}
                              onChange={(event) =>
                                updateStep(index, (current) =>
                                  current.type === "command"
                                    ? {
                                        ...current,
                                        command: event.target.value,
                                      }
                                    : current,
                                )
                              }
                            />
                            <label className="flex items-center gap-2 text-sm text-white/70">
                              <input
                                type="checkbox"
                                checked={step.waitForCompletion === true}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateStep(index, (current) =>
                                    current.type === "command"
                                      ? {
                                          ...current,
                                          waitForCompletion:
                                            event.target.checked,
                                        }
                                      : current,
                                  )
                                }
                              />
                              Wait for workflow completion
                            </label>
                          </div>
                        ) : widgetStep ? (
                          <WidgetStepFields
                            index={index}
                            step={step}
                            renderers={widgetRenderers}
                            readOnly={readOnly}
                            onChange={(nextStep) =>
                              updateStep(index, () => nextStep)
                            }
                          />
                        ) : (
                          <select
                            aria-label={`Step ${index + 1} renderer`}
                            className="mt-3 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                            value={step.rendererSlug}
                            disabled={readOnly}
                            onChange={(event) => {
                              updateStep(index, (current) =>
                                current.type === "flow"
                                  ? current
                                  : {
                                      ...current,
                                      rendererSlug: event.target.value,
                                      rendererData: undefined,
                                    },
                              );
                            }}
                          >
                            {listAuthoringRendererSlugs().map((slug) => (
                              <option key={slug} value={slug}>
                                {RENDERER_LABELS[slug] ?? slug}
                              </option>
                            ))}
                          </select>
                        )}
                        {step.type !== "flow" &&
                        step.type !== "command" &&
                        step.rendererSlug === "guided-form" &&
                        !step.filePicker ? (
                          <div className="mt-3 grid gap-3 rounded-lg border border-white/10 bg-black/15 p-3 sm:grid-cols-2">
                            <label className="block text-sm text-white/70">
                              Save response as
                              <input
                                aria-label={`Step ${index + 1} save response as`}
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                value={guidedFormPrimaryField(step).name}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateStep(index, (current) =>
                                    current.type === "flow" ||
                                    current.type === "command"
                                      ? current
                                      : withGuidedFormPrimaryField(current, {
                                          name: event.target.value,
                                        }),
                                  )
                                }
                              />
                            </label>
                            <label className="block text-sm text-white/70">
                              Field label
                              <input
                                aria-label={`Step ${index + 1} field label`}
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                                value={guidedFormPrimaryField(step).label}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateStep(index, (current) =>
                                    current.type === "flow" ||
                                    current.type === "command"
                                      ? current
                                      : withGuidedFormPrimaryField(current, {
                                          label: event.target.value,
                                        }),
                                  )
                                }
                              />
                            </label>
                          </div>
                        ) : null}
                        {step.type !== "flow" &&
                        step.type !== "command" &&
                        step.rendererSlug === "selection-list" ? (
                          <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
                            <label className="block text-sm text-white/70">
                              Choices source
                              <select
                                aria-label={`Step ${index + 1} choices source`}
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white"
                                value={step.itemsSource ? "cms" : "generated"}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateStep(index, (current) =>
                                    current.type === "flow" ||
                                    current.type === "command"
                                      ? current
                                      : {
                                          ...current,
                                          itemsSource:
                                            event.target.value === "cms"
                                              ? {
                                                  type: "cms",
                                                  collection: "",
                                                  labelField: "title",
                                                  valueField: "id",
                                                  resultField: "selectedId",
                                                }
                                              : undefined,
                                        },
                                  )
                                }
                              >
                                <option value="generated">
                                  Generated choices
                                </option>
                                <option value="cms">CMS collection</option>
                              </select>
                            </label>
                            {step.itemsSource ? (
                              <>
                                {[
                                  ["collection", "Collection"],
                                  ["labelField", "Label field"],
                                  ["valueField", "Value field"],
                                  ["resultField", "Save selection as"],
                                ].map(([field, label]) => (
                                  <label
                                    key={field}
                                    className="block text-sm text-white/70"
                                  >
                                    {label}
                                    <input
                                      aria-label={`Step ${index + 1} ${label.toLowerCase()}`}
                                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                      value={
                                        step.itemsSource?.[
                                          field as keyof typeof step.itemsSource
                                        ] as string
                                      }
                                      disabled={readOnly}
                                      onChange={(event) =>
                                        updateStep(index, (current) =>
                                          current.type === "flow" ||
                                          current.type === "command" ||
                                          !current.itemsSource
                                            ? current
                                            : {
                                                ...current,
                                                itemsSource: {
                                                  ...current.itemsSource,
                                                  [field]: event.target.value,
                                                },
                                              },
                                        )
                                      }
                                    />
                                  </label>
                                ))}
                                <label className="block text-sm text-white/70">
                                  Filter field (optional)
                                  <input
                                    aria-label={`Step ${index + 1} filter field`}
                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                    value={step.itemsSource.filter?.field ?? ""}
                                    disabled={readOnly}
                                    onChange={(event) =>
                                      updateStep(index, (current) =>
                                        current.type === "flow" ||
                                        current.type === "command" ||
                                        !current.itemsSource
                                          ? current
                                          : {
                                              ...current,
                                              itemsSource: {
                                                ...current.itemsSource,
                                                filter: event.target.value
                                                  ? {
                                                      field: event.target.value,
                                                      fromResultField:
                                                        current.itemsSource
                                                          .filter
                                                          ?.fromResultField ??
                                                        "",
                                                    }
                                                  : undefined,
                                              },
                                            },
                                      )
                                    }
                                  />
                                </label>
                                {step.itemsSource.filter ? (
                                  <label className="block text-sm text-white/70">
                                    Filter from saved selection
                                    <input
                                      aria-label={`Step ${index + 1} filter source`}
                                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                      value={
                                        step.itemsSource.filter.fromResultField
                                      }
                                      disabled={readOnly}
                                      onChange={(event) =>
                                        updateStep(index, (current) =>
                                          current.type === "flow" ||
                                          current.type === "command" ||
                                          !current.itemsSource?.filter
                                            ? current
                                            : {
                                                ...current,
                                                itemsSource: {
                                                  ...current.itemsSource,
                                                  filter: {
                                                    ...current.itemsSource
                                                      .filter,
                                                    fromResultField:
                                                      event.target.value,
                                                  },
                                                },
                                              },
                                        )
                                      }
                                    />
                                  </label>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        ) : null}
                        {rendererCatalogError && !readOnly ? (
                          <p className="mt-2 text-sm text-amber-200">
                            Widgets could not be loaded: {rendererCatalogError}
                          </p>
                        ) : null}
                        <div className="mt-3">
                          <DashboardPageFields
                            ariaLabel={`Step ${index + 1} page`}
                            visibleLabel="Page (optional)"
                            routeId={step.routeId ?? ""}
                            routeParameters={step.routeParameters ?? {}}
                            disabled={readOnly}
                            onChange={(routeId, routeParameters) =>
                              updateStep(index, (current) => ({
                                ...current,
                                routeId,
                                routeParameters,
                              }))
                            }
                          />
                        </div>
                        {step.type !== "flow" &&
                        step.type !== "command" &&
                        step.routeId === "files" &&
                        step.rendererSlug === "guided-form" ? (
                          <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-black/15 p-3">
                            <label className="flex items-center gap-3 text-sm text-white/80">
                              <input
                                type="checkbox"
                                aria-label={`Step ${index + 1} choose a file`}
                                checked={Boolean(step.filePicker)}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateStep(index, (current) =>
                                    current.type === "flow" ||
                                    current.type === "command"
                                      ? current
                                      : {
                                          ...current,
                                          filePicker: event.target.checked
                                            ? {
                                                resultField: "filePath",
                                              }
                                            : undefined,
                                          rendererData: event.target.checked
                                            ? {
                                                ...(current.rendererData ?? {}),
                                                fields: [
                                                  {
                                                    name: "filePath",
                                                    label: "Selected file",
                                                    value: "",
                                                    inputType: "text",
                                                  },
                                                ],
                                              }
                                            : current.rendererData,
                                        },
                                  )
                                }
                              />
                              Let the user choose a file
                            </label>
                            {step.filePicker ? (
                              <>
                                <label className="block text-sm text-white/70">
                                  Save file path as
                                  <input
                                    aria-label={`Step ${index + 1} file result field`}
                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                    value={step.filePicker.resultField}
                                    disabled={readOnly}
                                    onChange={(event) =>
                                      updateStep(index, (current) =>
                                        current.type === "flow" ||
                                        current.type === "command" ||
                                        !current.filePicker
                                          ? current
                                          : {
                                              ...current,
                                              filePicker: {
                                                ...current.filePicker,
                                                resultField: event.target.value,
                                              },
                                              rendererData: {
                                                ...(current.rendererData ?? {}),
                                                fields: [
                                                  {
                                                    name: event.target.value,
                                                    label: "Selected file",
                                                    value: "",
                                                    inputType: "text",
                                                  },
                                                ],
                                              },
                                            },
                                      )
                                    }
                                  />
                                </label>
                                <label className="block text-sm text-white/70">
                                  Allowed extensions (optional)
                                  <input
                                    aria-label={`Step ${index + 1} allowed file extensions`}
                                    placeholder=".pdf, .docx"
                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-white"
                                    value={
                                      step.filePicker.extensions?.join(", ") ??
                                      ""
                                    }
                                    disabled={readOnly}
                                    onChange={(event) => {
                                      const extensions = event.target.value
                                        .split(",")
                                        .map((value) => value.trim())
                                        .filter(Boolean);
                                      updateStep(index, (current) =>
                                        current.type === "flow" ||
                                        current.type === "command" ||
                                        !current.filePicker
                                          ? current
                                          : {
                                              ...current,
                                              filePicker: {
                                                ...current.filePicker,
                                                extensions:
                                                  extensions.length > 0
                                                    ? extensions
                                                    : undefined,
                                              },
                                            },
                                      );
                                    }}
                                  />
                                </label>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </section>
                      <section className="border-t border-white/10 pt-5">
                        <MarkdownEditor
                          value={step.explanation}
                          onChange={(explanation) =>
                            updateStep(index, (current) => ({
                              ...current,
                              explanation,
                            }))
                          }
                          placeholder="What should the user do?"
                          rows={6}
                          disabled={readOnly}
                          defaultMode={readOnly ? "preview" : "write"}
                          showToolbar={!readOnly}
                          showModeControls={!readOnly}
                          emptyPreview="No instructions provided."
                          textareaAriaLabel={`Step ${index + 1} instructions`}
                        />
                      </section>
                    </div>
                  </section>
                </div>
                <aside
                  aria-label={`Live preview ${index + 1}`}
                  className="h-fit self-start border-t border-white/10 pt-5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"
                >
                  <div
                    aria-label={`Preview step ${index + 1}`}
                    className="rounded-xl bg-black/25 p-3"
                  >
                    {stepPreview ? (
                      <RenderedViewCard
                        view={stepPreview}
                        disabled
                        onAction={() => undefined}
                      />
                    ) : (
                      <p className="py-8 text-center text-sm text-white/50">
                        Preview will appear here.
                      </p>
                    )}
                  </div>
                </aside>
              </article>
            );
          })}
        </div>
        {!readOnly ? (
          <Button
            variant="ghost"
            className="mt-4 w-full border border-dashed border-border text-muted-foreground hover:text-foreground"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                steps: [...current.steps, newDraftStep()],
              }))
            }
          >
            + Add step
          </Button>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly ? (
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              {saving ? "Saving…" : "Save Guided Flow"}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FlowDefinitionList({
  definitions,
  sourceScope,
  onView,
  onEdit,
  onDelete,
}: {
  definitions: readonly FlowDefinition[];
  sourceScope: GuidedFlowSourceScope;
  onView: (definition: FlowDefinition) => void;
  onEdit: (definition: FlowDefinition) => void;
  onDelete: (definition: FlowDefinition) => void;
}) {
  const { startFlowInChat } = useGuidedFlowChat();
  return (
    <ul className="space-y-2">
      {definitions.map((option) => (
        <li key={option.id}>
          <Card
            role="article"
            aria-label={option.title}
            className="border-white/[0.08] bg-white/[0.03]"
          >
            <CardContent className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-white/90">{option.title}</h3>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/50">
                    {option.source
                      ? "Generated"
                      : isBuiltinDefinition(option)
                        ? "Built-in"
                        : "Custom"}
                  </span>
                  <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-white/50">
                    v{option.version ?? 1}
                  </span>
                </div>
                <p className="mt-1 text-sm text-white/50">
                  {option.description ??
                    `${option.steps.length} guided step${option.steps.length === 1 ? "" : "s"}.`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  aria-label={`Start ${option.title} in Chat`}
                  onClick={() =>
                    startFlowInChat(option.id, undefined, sourceScope)
                  }
                >
                  <Play className="mr-1.5 h-4 w-4" />
                  Start in Chat
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`View ${option.title}`}
                  onClick={() => onView(option)}
                >
                  <Eye className="mr-1.5 h-4 w-4" />
                  View
                </Button>
                {!isReadOnlyDefinition(option) ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${option.title}`}
                      onClick={() => onEdit(option)}
                    >
                      <Pencil className="mr-1.5 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${option.title}`}
                      onClick={() => onDelete(option)}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function GuidedFlowsManager() {
  const { auth: connectedAuth } = useAuth();
  const pathname = usePathname();
  const auth = guidedFlowRequestAuth(pathname, connectedAuth);
  const [definitions, setDefinitions] = useState<FlowDefinition[]>(
    BUILTIN_START_OPTIONS,
  );
  const [sourceScope, setSourceScope] = useState<GuidedFlowSourceScope>({
    kind: "user",
  });
  const [editor, setEditor] = useState<{
    mode: "create" | "edit" | "view";
    definition?: FlowDefinition;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FlowDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sharedDefinitions = definitions.filter(isReadOnlyDefinition);
  const ownedDefinitions = definitions.filter(
    (definition) => !isReadOnlyDefinition(definition),
  );
  const ownerLabel = auth ? "Repository" : "Personal";
  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/kody/guided-flows?view=templates", {
        headers: buildAuthHeaders(auth),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      const payload = (await response.json()) as {
        definitions?: FlowDefinition[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load Guided Flows");
      }
      setDefinitions(payload.definitions ?? BUILTIN_START_OPTIONS);
      setSourceScope(
        auth
          ? { kind: "repository", owner: auth.owner, repo: auth.repo }
          : { kind: "user" },
      );
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? "Guided Flows took too long to load. Try again."
          : cause instanceof Error
            ? cause.message
            : "Unable to load Guided Flows",
      );
    }
  }, [auth]);

  const deleteDefinition = useCallback(
    async (definition: FlowDefinition) => {
      setDeleting(true);
      setError(null);
      try {
        const response = await fetch("/api/kody/guided-flows", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAuthHeaders(auth),
          },
          body: JSON.stringify({
            action: "delete-definition",
            flowId: definition.id,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to delete Guided Flow");
        }
        setDefinitions((current) =>
          current.filter((candidate) => candidate.id !== definition.id),
        );
        setDeleteTarget(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to delete Guided Flow",
        );
      } finally {
        setDeleting(false);
      }
    },
    [auth],
  );
  useEffect(() => void load(), [load]);
  return (
    <PageShell
      title={`${ownerLabel} Guided Flows`}
      subtitle={`Manage guides owned by ${auth ? "this repository" : "your account"}.`}
      icon={Route}
      iconClassName="text-teal-300"
      width="wide"
      backHref={auth ? repoScopedHref(auth, "/") : null}
    >
      <div className="space-y-8">
        {error ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200"
          >
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        {editor ? (
          <FlowBuilder
            key={`${editor.mode}:${editor.definition?.id ?? "new"}`}
            mode={editor.mode}
            definition={editor.definition}
            flowOptions={definitions}
            onClose={() => setEditor(null)}
            requestAuth={auth}
            onSaved={(definition) => {
              setDefinitions((current) => {
                const exists = current.some(
                  (candidate) => candidate.id === definition.id,
                );
                return exists
                  ? current.map((candidate) =>
                      candidate.id === definition.id ? definition : candidate,
                    )
                  : [...current, definition];
              });
              setEditor(null);
            }}
          />
        ) : null}
        <section aria-label="Shared guides">
          <div className="mb-3">
            <h2 className="text-lg font-semibold text-white/90">
              Shared guides
            </h2>
            <p className="mt-1 text-sm text-white/50">
              Built-in and generated guides are available in every scope and are
              read-only.
            </p>
          </div>
          <FlowDefinitionList
            definitions={sharedDefinitions}
            sourceScope={sourceScope}
            onView={(definition) => setEditor({ mode: "view", definition })}
            onEdit={(definition) => setEditor({ mode: "edit", definition })}
            onDelete={setDeleteTarget}
          />
        </section>
        <section aria-label={`${ownerLabel} guides`}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white/90">
                {ownerLabel} guides
              </h2>
              <p className="mt-1 text-sm text-white/50">
                These custom guides belong only to{" "}
                {auth ? "this repository" : "your account"}.
              </p>
            </div>
            <Button size="sm" onClick={() => setEditor({ mode: "create" })}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Guided Flow
            </Button>
          </div>
          {ownedDefinitions.length > 0 ? (
            <FlowDefinitionList
              definitions={ownedDefinitions}
              sourceScope={sourceScope}
              onView={(definition) => setEditor({ mode: "view", definition })}
              onEdit={(definition) => setEditor({ mode: "edit", definition })}
              onDelete={setDeleteTarget}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/50">
              No {ownerLabel.toLowerCase()} guides yet.
            </p>
          )}
        </section>
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Delete Guided Flow"
          description={
            deleteTarget
              ? `Delete “${deleteTarget.title}”? New users will no longer be able to start this definition.`
              : ""
          }
          confirmLabel={deleting ? "Deleting…" : "Delete"}
          variant="destructive"
          onConfirm={() => {
            if (deleteTarget) void deleteDefinition(deleteTarget);
          }}
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        />
      </div>
    </PageShell>
  );
}

export default function GuidedFlowsPage() {
  return <GuidedFlowsManager />;
}
