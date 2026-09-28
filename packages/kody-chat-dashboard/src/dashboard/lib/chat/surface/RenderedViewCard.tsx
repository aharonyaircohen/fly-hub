/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Renders a `show_view` directive as generic UI atoms (stack /
 * row / list / text / markdown / input / button / checkbox / submit) inside
 * an assistant bubble. Extracted verbatim from KodyChat (Step 3); action
 * handling stays with the host via `onAction`.
 */
"use client";

import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { trackSystemEvent } from "@kody-ade/base/events/client";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import {
  getRenderedViewUi,
  type RenderedViewAction,
  type RenderedViewDirective,
  type RenderedViewUiNode,
} from "../../chat-ui-actions";
import { WidgetHost } from "./WidgetHost";
import type { WidgetHostEvent } from "./widget-host";
import {
  VIEW_RENDERER_MARKDOWN_CLASS,
  VIEW_RENDERER_TEXT_CLASS,
  VIEW_RENDERER_TITLE_CLASS,
} from "../../view-renderers/typography";
import { authHeaders } from "../../kody-chat-live-session";
import { cmsSelectionItems } from "../../guided-flows/cms-items";
import { createWidgetCmsClient } from "./widget-host";
import {
  consumeGuidedFlowFileSelection,
  GUIDED_FLOW_FILE_SELECTED_EVENT,
  type GuidedFlowFileSelection,
} from "../../guided-flows/file-picker";

export function replaceFirstRenderedViewList(
  node: RenderedViewUiNode,
  actions: readonly RenderedViewAction[],
): RenderedViewUiNode {
  return replaceFirstRenderedViewListNode(node, actions).node;
}

function replaceFirstRenderedViewListNode(
  node: RenderedViewUiNode,
  actions: readonly RenderedViewAction[],
): { node: RenderedViewUiNode; replaced: boolean } {
  if (node.type === "list") {
    return {
      node: {
        ...node,
        children: actions.map((action) => ({
          type: "button" as const,
          label: action.label,
          action,
        })),
      },
      replaced: true,
    };
  }
  if (node.type !== "stack" && node.type !== "row") {
    return { node, replaced: false };
  }
  let replaced = false;
  const children = node.children.map((child) => {
    if (replaced) return child;
    const next = replaceFirstRenderedViewListNode(child, actions);
    replaced = next.replaced;
    return next.node;
  });
  return {
    node: replaced ? { ...node, children } : node,
    replaced,
  };
}

export function hasCheckboxNodes(node: RenderedViewUiNode): boolean {
  if (node.type === "checkbox") return true;
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    return node.children.some(hasCheckboxNodes);
  }
  return false;
}

/** Read-only renderer inputs are display fields, not form controls. */
export function isReadOnlyViewInput(
  node: Extract<RenderedViewUiNode, { type: "input" }>,
): boolean {
  return node.readOnly !== false;
}

/** Inactive view cards must not leave editable fields in the tab order. */
export function isViewInputDisabled(cardDisabled: boolean): boolean {
  return cardDisabled;
}

export function validateGuidedFlowInput(
  ui: RenderedViewUiNode,
  inputValues: Record<string, string>,
): string | null {
  const inputs: Array<{ name: string; label: string; value: string }> = [];
  const collect = (node: RenderedViewUiNode) => {
    if (node.type === "input" && node.name && !node.readOnly) {
      inputs.push({
        name: node.name,
        label: node.label ?? node.name,
        value: (inputValues[node.name] ?? node.value ?? "").trim(),
      });
      return;
    }
    if (node.type === "stack" || node.type === "row" || node.type === "list") {
      node.children.forEach(collect);
    }
  };
  collect(ui);

  const workflowName = inputs.find((input) => input.name === "workflowName");
  if (workflowName && !workflowName.value) {
    return "Enter a name for this workflow.";
  }
  const capabilitySlug = inputs.find(
    (input) => input.name === "capabilitySlug",
  );
  if (capabilitySlug && !capabilitySlug.value) {
    return "Choose a capability for this workflow.";
  }
  if (
    capabilitySlug &&
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(capabilitySlug.value)
  ) {
    return "Choose an available capability from the list.";
  }
  return null;
}

/**
 * The text reply a form submit sends back to the model. Views with
 * checkboxes report the selection ("Selected: …", explicit "none" when
 * unchecked). Views without checkboxes are plain confirmations (approval
 * cards) — the reply is the button label itself; "Selected: none" there
 * reads as a rejection.
 */
export function buildSubmitResponse(
  ui: RenderedViewUiNode,
  formValues: Record<string, Array<{ value: string; label: string }>>,
  label: string,
): string {
  if (!hasCheckboxNodes(ui)) return label;
  const selected = Object.values(formValues).flat();
  if (selected.length === 0) return "Selected: none";
  const selectedText = selected
    .map((item) =>
      item.value === item.label ? item.label : `${item.label} (${item.value})`,
    )
    .join(", ");
  return `Selected: ${selectedText}`;
}

export function RenderedViewCard({
  view,
  disabled,
  onAction,
  onWidgetEvent,
}: {
  view: RenderedViewDirective;
  disabled: boolean;
  onAction: (action: RenderedViewAction) => void;
  onWidgetEvent?: (event: WidgetHostEvent) => void;
}) {
  const ui = getRenderedViewUi(view);
  const [cmsActions, setCmsActions] = useState<RenderedViewAction[] | null>(
    view.dataSource ? null : [],
  );
  const [cmsError, setCmsError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<
    Record<string, Array<{ value: string; label: string }>>
  >({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => {
    if (!view.guidedFlow || !view.filePicker) return;
    const picker = {
      ...view.guidedFlow,
      ...view.filePicker,
    };
    const applySelection = (selection: GuidedFlowFileSelection | null) => {
      if (
        !selection ||
        selection.instanceId !== picker.instanceId ||
        selection.stepId !== picker.stepId ||
        selection.revision !== picker.revision ||
        selection.resultField !== picker.resultField
      ) {
        return;
      }
      setInputValues((current) => ({
        ...current,
        [selection.resultField]: selection.filePath,
        [`${selection.resultField}Name`]: selection.fileName,
      }));
    };
    applySelection(
      consumeGuidedFlowFileSelection(window.sessionStorage, picker),
    );
    const onFileSelected = (event: Event) => {
      applySelection(
        event instanceof CustomEvent
          ? (event.detail as GuidedFlowFileSelection)
          : null,
      );
    };
    window.addEventListener(GUIDED_FLOW_FILE_SELECTED_EVENT, onFileSelected);
    return () =>
      window.removeEventListener(
        GUIDED_FLOW_FILE_SELECTED_EVENT,
        onFileSelected,
      );
  }, [view.filePicker, view.guidedFlow]);
  useEffect(() => {
    trackSystemEvent("ui.view.shown", { renderer: view.rendererSlug });
  }, [view.rendererSlug]);
  useEffect(() => {
    const source = view.dataSource;
    if (!source) {
      setCmsActions([]);
      setCmsError(null);
      return;
    }
    if (source.unavailable === "missing_filter_value") {
      setCmsActions([]);
      setCmsError("Choose the parent item first.");
      return;
    }
    let cancelled = false;
    setCmsActions(null);
    setCmsError(null);
    createWidgetCmsClient(authHeaders())
      .list(source.collection, {
        ...(source.filter
          ? {
              filters: {
                [source.filter.field]: { equals: source.filter.value },
              },
            }
          : {}),
        sort: [{ field: source.labelField, direction: "asc" }],
        limit: 100,
      })
      .then((result) => {
        if (cancelled) return;
        const actions = cmsSelectionItems(source, result.docs);
        setCmsActions(actions);
        if (actions.length === 0) setCmsError("No choices available.");
      })
      .catch(() => {
        if (!cancelled) {
          setCmsActions([]);
          setCmsError("Unable to load choices. Try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view.dataSource]);
  const renderedUi = view.dataSource
    ? replaceFirstRenderedViewList(ui, cmsActions ?? [])
    : ui;
  const trackAction = (action: RenderedViewAction) => {
    trackSystemEvent("ui.action.clicked", {
      viewId: view.rendererSlug,
      actionId: action.id,
    });
    onAction(action);
  };
  const toggleFormValue = (name: string, value: string, label: string) => {
    setFormValues((current) => {
      const values = current[name] ?? [];
      const nextValues = values.some((candidate) => candidate.value === value)
        ? values.filter((candidate) => candidate.value !== value)
        : [...values, { value, label }];
      return { ...current, [name]: nextValues };
    });
  };
  const submitForm = (label: string) => {
    if (view.resultTarget === "guided-flow") {
      const error = validateGuidedFlowInput(renderedUi, inputValues);
      if (error) {
        setValidationError(error);
        return;
      }
    }
    setValidationError(null);
    const response = buildSubmitResponse(renderedUi, formValues, label);
    trackSystemEvent("ui.form.submitted", {
      viewId: view.rendererSlug,
      fields: Object.keys(formValues),
    });
    onAction({
      id: "submit",
      label,
      response,
      result: { ...formValues, ...inputValues },
    });
  };
  const renderButton = (
    node: Extract<RenderedViewUiNode, { type: "button" }>,
    key: string,
    layout: "row" | "list",
  ) => {
    const isPrimary = node.action.variant === "primary";
    const isDanger = node.action.variant === "danger";
    const rowTone = isPrimary
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : isDanger
        ? "border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border-border bg-transparent text-foreground hover:bg-accent";
    if (layout === "list") {
      const Icon = isDanger ? X : ChevronRight;
      const listTone = isPrimary
        ? "bg-primary/10 text-foreground hover:bg-primary/15"
        : isDanger
          ? "text-destructive hover:bg-destructive/10"
          : "text-foreground hover:bg-accent/70";
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => trackAction(node.action)}
          className={`group flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-2 py-3 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${listTone}`}
        >
          <span dir="auto" className="min-w-0 break-words font-medium">
            {node.label}
          </span>
          <Icon
            className={`h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5 ${
              isPrimary ? "text-primary" : "text-muted-foreground"
            }`}
          />
        </button>
      );
    }
    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={() => trackAction(node.action)}
        className={`inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${rowTone}`}
      >
        <span dir="auto">{node.label}</span>
      </button>
    );
  };
  const renderNode = (
    node: RenderedViewUiNode,
    key: string,
    layout: "row" | "list" = "row",
  ): ReactNode => {
    if (node.type === "stack") {
      return (
        <div key={key} className="space-y-4">
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`),
          )}
        </div>
      );
    }
    if (node.type === "row") {
      return (
        <div key={key} className="flex flex-wrap items-center gap-2">
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`, "row"),
          )}
        </div>
      );
    }
    if (node.type === "list") {
      return (
        <div
          key={key}
          className="divide-y divide-border border-y border-border"
        >
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`, "list"),
          )}
        </div>
      );
    }
    if (node.type === "text") {
      if (node.variant === "title") {
        return (
          <h3 key={key} dir="auto" className={VIEW_RENDERER_TITLE_CLASS}>
            {node.value}
          </h3>
        );
      }
      if (node.variant === "label") {
        return (
          <div
            key={key}
            dir="auto"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {node.value}
          </div>
        );
      }
      return (
        <p
          key={key}
          dir="auto"
          className={`${VIEW_RENDERER_TEXT_CLASS} ${
            layout === "list" ? "px-2 py-3" : ""
          }`}
        >
          {node.value}
        </p>
      );
    }
    if (node.type === "markdown") {
      return (
        <MarkdownPreview
          key={key}
          content={node.value}
          className={VIEW_RENDERER_MARKDOWN_CLASS}
        />
      );
    }
    if (node.type === "input") {
      const value = node.name
        ? (inputValues[node.name] ?? node.value)
        : node.value;
      const readOnly = isReadOnlyViewInput(node);
      if (readOnly) {
        return (
          <div key={key} className="block space-y-1.5">
            {node.label ? (
              <span className="text-xs font-medium text-muted-foreground">
                {node.label}
              </span>
            ) : null}
            <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-foreground">
              {value}
            </p>
          </div>
        );
      }
      const onChange = (
        event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => {
        if (!node.name || node.readOnly) return;
        setInputValues((current) => ({
          ...current,
          [node.name!]: event.target.value,
        }));
      };
      return (
        <label key={key} className="block space-y-1.5">
          {node.label ? (
            <span className="text-xs font-medium text-muted-foreground">
              {node.label}
            </span>
          ) : null}
          {node.inputType === "textarea" ? (
            <textarea
              value={value}
              readOnly={false}
              disabled={isViewInputDisabled(disabled)}
              rows={4}
              onChange={onChange}
              className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          ) : (
            <input
              value={value}
              readOnly={false}
              disabled={isViewInputDisabled(disabled)}
              type={node.inputType ?? "text"}
              onChange={onChange}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          )}
        </label>
      );
    }
    if (node.type === "button") {
      return renderButton(node, key, layout);
    }
    if (node.type === "checkbox") {
      const checked = (formValues[node.name] ?? []).some(
        (candidate) => candidate.value === node.value,
      );
      return (
        <label
          key={key}
          className={`flex min-h-11 w-full items-center gap-3 px-2 py-3 text-start text-sm transition-colors ${
            checked ? "bg-primary/10" : "hover:bg-accent/70"
          } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggleFormValue(node.name, node.value, node.label)}
            className="h-4 w-4 shrink-0 rounded border-border accent-primary"
          />
          <span dir="auto" className="min-w-0 flex-1 break-words font-medium">
            {node.label}
          </span>
        </label>
      );
    }
    if (node.type === "widget") {
      return (
        <WidgetHost
          key={key}
          slug={node.widget}
          version={node.version}
          data={node.data}
          preview={node.preview}
          disabled={disabled}
          onEvent={(event) => {
            if (event.type === "submit-result") {
              trackSystemEvent("ui.action.clicked", {
                viewId: view.rendererSlug,
                actionId: event.actionId,
              });
            }
            onWidgetEvent?.(event);
          }}
        />
      );
    }
    if (node.type === "submit") {
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => submitForm(node.label)}
          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          {node.label}
        </button>
      );
    }
    return null;
  };
  return (
    <div className="mt-2 text-sm">
      {validationError ? (
        <div
          role="alert"
          className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200"
        >
          {validationError}
        </div>
      ) : null}
      {cmsActions === null ? (
        <p className="text-muted-foreground">Loading choices…</p>
      ) : null}
      {cmsError ? (
        <div role="alert" className="text-destructive">
          {cmsError}
        </div>
      ) : null}
      {renderNode(renderedUi, "root")}
    </div>
  );
}
