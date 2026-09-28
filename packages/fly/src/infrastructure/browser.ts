/** Public browser-provider facade for application code. */
export { getBrowserProvider } from "./installed";
export {
  browserAppName,
  ensureBrowserSessionReady,
  getBrowserMachineDiagnostic,
} from "../plugin/browsers";
export type {
  CreateFlyBrowserSessionInput,
  FlyBrowserAction,
  FlyBrowserActionResult,
  FlyBrowserProvider,
  FlyBrowserSession,
} from "../plugin/browsers";
