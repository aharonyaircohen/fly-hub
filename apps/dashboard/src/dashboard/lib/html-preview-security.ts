export const FILE_HTML_PREVIEW_SANDBOX = "allow-scripts";

export const FILE_HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: data: blob:",
  "style-src 'unsafe-inline' https: data: blob:",
  "img-src https: data: blob:",
  "font-src https: data:",
  "media-src https: data: blob:",
  "connect-src https:",
  "worker-src https: blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export const REPO_VIEW_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-downloads";

export const REPO_VIEW_CSP = [
  `sandbox ${REPO_VIEW_SANDBOX}`,
  "default-src 'self' data: blob: http: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' http: https:",
  "style-src 'self' 'unsafe-inline' http: https:",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data: http: https:",
  "connect-src 'self' data: blob: http: https:",
  "worker-src blob: http: https:",
].join("; ");
