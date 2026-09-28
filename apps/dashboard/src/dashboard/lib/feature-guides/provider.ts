/**
 * @fileType adapter
 * @domain features
 * @pattern dashboard-feature-guide-provider
 * @ai-summary One host-owned provider instance shared by direct chat and
 *   Brain route adapters. The Brain runtime receives selected guide text but
 *   does not own or load Dashboard feature files.
 */
import "server-only";

import { join } from "node:path";

import { createFileFeatureGuideProvider } from "./server";

export const dashboardFeatureGuideProvider = createFileFeatureGuideProvider({
  rootDirectory: join(process.cwd(), "src/dashboard/features"),
});
