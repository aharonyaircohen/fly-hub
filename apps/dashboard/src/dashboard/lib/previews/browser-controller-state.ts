export interface BrowserPageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  revision: number;
}

export type BrowserControllerPhase =
  | "disabled"
  | "starting"
  | "iframe"
  | "ready"
  | "navigating"
  | "recovering"
  | "error";

export interface BrowserControllerState {
  phase: BrowserControllerPhase;
  page: BrowserPageState;
  activeEnvironmentId: string | null;
  requestedEnvironmentId: string | null;
  requestedUrl: string | null;
  navigationRequestId: number | null;
  fallbackReason: string | null;
  error: string | null;
}

export const emptyBrowserPageState: BrowserPageState = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  revision: 0,
};

export const initialBrowserControllerState: BrowserControllerState = {
  phase: "disabled",
  page: emptyBrowserPageState,
  activeEnvironmentId: null,
  requestedEnvironmentId: null,
  requestedUrl: null,
  navigationRequestId: null,
  fallbackReason: null,
  error: null,
};

export type BrowserControllerEvent =
  | { type: "sessionStarting" }
  | {
      type: "sessionReady";
      page: BrowserPageState;
      environmentId?: string | null;
    }
  | {
      type: "navigationRequested";
      requestId: number;
      environmentId: string | null;
      url: string;
    }
  | {
      type: "navigationCommitted";
      requestId: number;
      page: BrowserPageState;
    }
  | { type: "navigationFailed"; requestId: number; error: string }
  | { type: "pageChanged"; page: BrowserPageState }
  | { type: "recovering" }
  | { type: "disconnected"; error: string }
  | { type: "iframeAvailable"; reason: string }
  | { type: "disabled" };

function isCurrentNavigation(
  state: BrowserControllerState,
  requestId: number,
): boolean {
  return state.navigationRequestId === requestId;
}

export function browserControllerReducer(
  state: BrowserControllerState,
  event: BrowserControllerEvent,
): BrowserControllerState {
  switch (event.type) {
    case "sessionStarting":
      return {
        ...state,
        phase: "starting",
        fallbackReason: null,
        error: null,
      };
    case "sessionReady":
      return {
        ...state,
        phase: "ready",
        page: event.page,
        activeEnvironmentId: event.environmentId ?? state.activeEnvironmentId,
        requestedEnvironmentId: null,
        requestedUrl: null,
        navigationRequestId: null,
        fallbackReason: null,
        error: null,
      };
    case "navigationRequested":
      return {
        ...state,
        phase: "navigating",
        requestedEnvironmentId: event.environmentId,
        requestedUrl: event.url,
        navigationRequestId: event.requestId,
        error: null,
      };
    case "navigationCommitted":
      if (!isCurrentNavigation(state, event.requestId)) return state;
      return {
        ...state,
        phase: "ready",
        page: event.page,
        activeEnvironmentId: state.requestedEnvironmentId,
        requestedEnvironmentId: null,
        requestedUrl: null,
        navigationRequestId: null,
        error: null,
      };
    case "navigationFailed":
      if (!isCurrentNavigation(state, event.requestId)) return state;
      return {
        ...state,
        phase: "error",
        requestedEnvironmentId: null,
        requestedUrl: null,
        navigationRequestId: null,
        error: event.error,
      };
    case "pageChanged":
      if (event.page.revision < state.page.revision) return state;
      return {
        ...state,
        page: event.page,
        activeEnvironmentId:
          state.phase !== "navigating" && event.page.url !== state.page.url
            ? null
            : state.activeEnvironmentId,
      };
    case "recovering":
      return { ...state, phase: "recovering", error: null };
    case "disconnected":
      return { ...state, phase: "error", error: event.error };
    case "iframeAvailable":
      return {
        ...initialBrowserControllerState,
        phase: "iframe",
        fallbackReason: event.reason,
      };
    case "disabled":
      return initialBrowserControllerState;
  }
}
