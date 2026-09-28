/** Server-only singleton for host-owned Dashboard feature guides. */
import "server-only";

import {
  createFeatureGuideRegistry,
  type FeatureGuideRegistry,
} from "./feature-guide-context";

const registry = createFeatureGuideRegistry();

export function getFeatureGuideRegistry(): FeatureGuideRegistry {
  return registry;
}
