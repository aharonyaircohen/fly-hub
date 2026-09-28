/**
 * @fileType types
 * @domain kody
 * @pattern shared-contract
 * @ai-summary Shared contract between the in-process chat route's UI tools
 *  (server) and KodyChat.tsx's stream parser (client). The route's
 *  `switch_agent` tool returns a `SwitchAgentDirective`; the client detects
 *  it via `isSwitchAgentDirective` in the tool-output-available stream chunk.
 */
import type { AgentId } from "./agents";

export const SWITCH_AGENT_DIRECTIVE = "switch_agent" as const;
export const PREVIEW_ACT_DIRECTIVE = "preview_act" as const;
export const DASHBOARD_NAVIGATE_DIRECTIVE = "dashboard_navigate" as const;
export const RENDER_VIEW_DIRECTIVE = "render_view" as const;

/**
 * Voice is a modality, not an agent — every agent in the registry is a
 * legitimate switch target. Alias kept so the codebase can document intent
 * (and so callers don't have to import AgentId just to type a directive).
 */
export type SwitchAgentTargetId = AgentId;

export interface SwitchAgentDirective {
  action: typeof SWITCH_AGENT_DIRECTIVE;
  agentId: SwitchAgentTargetId;
  agentName: string;
  reason: string;
  /**
   * Optional kickoff message. When set, the client auto-sends this string
   * as the first user message under the new agent after the switch. This is
   * kept as a generic switch-agent affordance; Vibe execution uses the
   * dedicated `/api/kody/vibe/execute` workflow instead.
   */
  autoKickoff?: string;
  /**
   * Issue number the kickoff targets. The client gates the auto-kickoff
   * useEffect on `context.task.issueNumber === autoKickoffIssueNumber`
   * — without that gate, the kickoff fires the moment context flips to
   * ANY task scope (typically the previously-viewed issue, because the
   * tasks list hasn't refetched the NEW one yet), and the runner gets
   * dispatched against the wrong sessionId.
   */
  autoKickoffIssueNumber?: number;
}

/**
 * A chat-driven action against the preview frame. The server tool just emits
 * this directive; the client (KodyChat) hands it to the Kody Preview
 * Inspector extension via `useElementPicker.act()` and replies with a
 * synthetic user message carrying the result so the model can chain steps.
 */
export interface PreviewActDirective {
  action: typeof PREVIEW_ACT_DIRECTIVE;
  /** Single-character op + selector + value, mirroring PreviewAction. */
  op: "click" | "fill" | "navigate" | "upload" | "scroll" | "wait";
  /** Present only for a repository Capability using the user's View browser. */
  capabilitySlug?: string;
  /** Exact HTTPS origins declared by that Capability. */
  allowedOrigins?: string[];
  selector?: string;
  value?: string;
  url?: string;
  /** Repository file paths resolved by the Dashboard host, never by Fly. */
  paths?: string[];
  dy?: number;
  ms?: number;
  /** Short rationale shown to the user (e.g. "logging you in to verify"). */
  reason: string;
}

/**
 * A chat-driven navigation request inside the Dashboard shell. The server
 * validates the route against the dashboard navigation catalog, then the
 * client scopes it to the active repo and calls the Next router.
 */
export interface DashboardNavigateDirective {
  action: typeof DASHBOARD_NAVIGATE_DIRECTIVE;
  routeId: string;
  href: string;
  label: string;
  reason: string;
}

export interface RenderedViewAction {
  id: string;
  label: string;
  response: string;
  variant?: "primary" | "secondary" | "danger";
  result?: Record<string, unknown>;
  dispatch?: {
    type: "control";
    id: string;
  };
}

export type RenderedViewJsonValue =
  | string
  | number
  | boolean
  | null
  | RenderedViewJsonValue[]
  | { [key: string]: RenderedViewJsonValue };

export type RenderedViewDataValue =
  | RenderedViewJsonValue
  | RenderedViewAction[]
  | Array<Record<string, string | boolean>>;

export function isRenderedViewJsonValue(
  value: unknown,
): value is RenderedViewJsonValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every(isRenderedViewJsonValue)) ||
    (!!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value as Record<string, unknown>).every(
        isRenderedViewJsonValue,
      ))
  );
}

export type RenderedViewUiNode =
  | {
      type: "stack" | "row" | "list";
      children: RenderedViewUiNode[];
    }
  | {
      type: "text";
      value: string;
      variant?: "title" | "body" | "label";
    }
  | {
      type: "markdown";
      value: string;
    }
  | {
      type: "input";
      value: string;
      label?: string;
      name?: string;
      inputType?: "text" | "password" | "textarea";
      readOnly?: boolean;
    }
  | {
      type: "button";
      label: string;
      action: RenderedViewAction;
    }
  | {
      type: "checkbox";
      name: string;
      value: string;
      label: string;
    }
  | {
      type: "submit";
      label: string;
    }
  | {
      /**
       * Tenant-authored widget: the chat surface dynamic-imports the
       * tenant's published bundle for `widget` (a slug) and mounts it with
       * `data` plus the host contract (theme + complete callback).
       */
      type: "widget";
      widget: string;
      /** Exact published widget bundle version. */
      version?: number;
      data?: unknown;
      /** Use the widget bundle's optional previewData export. */
      preview?: boolean;
    };

export interface RenderedViewDirective {
  action: typeof RENDER_VIEW_DIRECTIVE;
  view: "renderer";
  id: string;
  rendererSlug: string;
  rendererName: string;
  resultTarget: "chat" | "guided-flow";
  guidedFlow?: {
    instanceId: string;
    stepId: string;
    revision: number;
  };
  filePicker?: {
    resultField: string;
    extensions?: readonly string[];
  };
  ui: RenderedViewUiNode;
  data: Record<string, RenderedViewDataValue>;
  dataSource?: RenderedViewCmsItemsSource;
  /** Durable completion state for an interactive view instance. */
  result?: {
    actionId: string;
    data?: Record<string, unknown>;
    completedAt: string;
  };
}

export interface RenderedViewCmsItemsSource {
  readonly type: "cms";
  readonly collection: string;
  readonly labelField: string;
  readonly valueField: string;
  readonly resultField: string;
  readonly filter?: {
    readonly field: string;
    readonly value: string | number | boolean;
  };
  readonly unavailable?: "missing_filter_value";
}

export type ChatViewDirective = RenderedViewDirective;

export function isPreviewActDirective(
  value: unknown,
): value is PreviewActDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.action !== PREVIEW_ACT_DIRECTIVE) return false;
  const okOp =
    v.op === "click" ||
    v.op === "fill" ||
    v.op === "navigate" ||
    v.op === "upload" ||
    v.op === "scroll" ||
    v.op === "wait";
  return okOp && typeof v.reason === "string";
}

export function isDashboardNavigateDirective(
  value: unknown,
): value is DashboardNavigateDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.action === DASHBOARD_NAVIGATE_DIRECTIVE &&
    typeof v.routeId === "string" &&
    typeof v.href === "string" &&
    v.href.startsWith("/") &&
    !v.href.startsWith("//") &&
    typeof v.label === "string" &&
    typeof v.reason === "string"
  );
}

function isRenderedViewAction(value: unknown): value is RenderedViewAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const validVariant =
    v.variant === undefined ||
    v.variant === "primary" ||
    v.variant === "secondary" ||
    v.variant === "danger";
  const validDispatch =
    v.dispatch === undefined ||
    (!!v.dispatch &&
      typeof v.dispatch === "object" &&
      !Array.isArray(v.dispatch) &&
      (v.dispatch as Record<string, unknown>).type === "control" &&
      typeof (v.dispatch as Record<string, unknown>).id === "string");
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.response === "string" &&
    validVariant &&
    validDispatch
  );
}

function isRenderedViewDataValue(
  value: unknown,
): value is RenderedViewDataValue {
  return (
    isRenderedViewJsonValue(value) ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          isRenderedViewAction(item) ||
          (!!item &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            Object.values(item as Record<string, unknown>).every(
              (entry) =>
                typeof entry === "string" || typeof entry === "boolean",
            )),
      ))
  );
}

function isRenderedViewUiNode(value: unknown): value is RenderedViewUiNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    return (
      Array.isArray(node.children) && node.children.every(isRenderedViewUiNode)
    );
  }
  if (node.type === "text") {
    return (
      typeof node.value === "string" &&
      (node.variant === undefined ||
        node.variant === "title" ||
        node.variant === "body" ||
        node.variant === "label")
    );
  }
  if (node.type === "markdown") {
    return typeof node.value === "string";
  }
  if (node.type === "input") {
    return (
      typeof node.value === "string" &&
      (node.label === undefined || typeof node.label === "string") &&
      (node.name === undefined || typeof node.name === "string") &&
      (node.inputType === undefined ||
        node.inputType === "text" ||
        node.inputType === "password" ||
        node.inputType === "textarea") &&
      (node.readOnly === undefined || typeof node.readOnly === "boolean")
    );
  }
  if (node.type === "button") {
    return typeof node.label === "string" && isRenderedViewAction(node.action);
  }
  if (node.type === "checkbox") {
    return (
      typeof node.name === "string" &&
      typeof node.value === "string" &&
      typeof node.label === "string"
    );
  }
  if (node.type === "submit") {
    return typeof node.label === "string";
  }
  if (node.type === "widget") {
    return typeof node.widget === "string" && node.widget.length > 0;
  }
  return false;
}

export function isRenderedViewDirective(
  value: unknown,
): value is RenderedViewDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    v.action !== RENDER_VIEW_DIRECTIVE ||
    v.view !== "renderer" ||
    typeof v.id !== "string" ||
    typeof v.rendererSlug !== "string" ||
    typeof v.rendererName !== "string" ||
    (v.resultTarget !== "chat" && v.resultTarget !== "guided-flow") ||
    !isRenderedViewUiNode(v.ui) ||
    !v.data ||
    typeof v.data !== "object" ||
    Array.isArray(v.data)
  ) {
    return false;
  }
  if (v.resultTarget === "guided-flow") {
    const flow = v.guidedFlow;
    if (
      !flow ||
      typeof flow !== "object" ||
      typeof (flow as Record<string, unknown>).instanceId !== "string" ||
      typeof (flow as Record<string, unknown>).stepId !== "string" ||
      typeof (flow as Record<string, unknown>).revision !== "number"
    ) {
      return false;
    }
  }
  if (
    v.dataSource !== undefined &&
    !isRenderedViewCmsItemsSource(v.dataSource)
  ) {
    return false;
  }
  if (v.result !== undefined) {
    const result = v.result;
    if (
      !result ||
      typeof result !== "object" ||
      typeof (result as Record<string, unknown>).actionId !== "string" ||
      typeof (result as Record<string, unknown>).completedAt !== "string"
    ) {
      return false;
    }
    const resultData = (result as Record<string, unknown>).data;
    if (
      resultData !== undefined &&
      (!resultData ||
        typeof resultData !== "object" ||
        Array.isArray(resultData))
    ) {
      return false;
    }
  }
  return Object.values(v.data as Record<string, unknown>).every(
    isRenderedViewDataValue,
  );
}

function isRenderedViewCmsItemsSource(
  value: unknown,
): value is RenderedViewCmsItemsSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (
    source.type !== "cms" ||
    typeof source.collection !== "string" ||
    typeof source.labelField !== "string" ||
    typeof source.valueField !== "string" ||
    typeof source.resultField !== "string"
  ) {
    return false;
  }
  if (
    source.unavailable !== undefined &&
    source.unavailable !== "missing_filter_value"
  ) {
    return false;
  }
  if (source.filter === undefined) return true;
  if (!source.filter || typeof source.filter !== "object") return false;
  const filter = source.filter as Record<string, unknown>;
  return (
    typeof filter.field === "string" &&
    (typeof filter.value === "string" ||
      typeof filter.value === "number" ||
      typeof filter.value === "boolean")
  );
}

export function getRenderedViewUi(
  view: RenderedViewDirective,
): RenderedViewUiNode {
  return view.ui;
}

export function isSwitchAgentDirective(
  value: unknown,
): value is SwitchAgentDirective {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.action === SWITCH_AGENT_DIRECTIVE &&
    typeof v.agentId === "string" &&
    typeof v.agentName === "string" &&
    typeof v.reason === "string" &&
    (v.autoKickoff === undefined || typeof v.autoKickoff === "string") &&
    (v.autoKickoffIssueNumber === undefined ||
      (typeof v.autoKickoffIssueNumber === "number" &&
        Number.isInteger(v.autoKickoffIssueNumber) &&
        v.autoKickoffIssueNumber > 0))
  );
}
