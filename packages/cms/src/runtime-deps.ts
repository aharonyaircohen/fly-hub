import "server-only";

import { MongoClient, ObjectId } from "mongodb";

/**
 * Remote Store adapters are materialized into /tmp, where serverless bundles
 * cannot resolve host packages. Inject the supported runtime dependencies into
 * the adapter factory instead of making downloaded code import them by path.
 */
export function getStoreAdapterRuntime(
  adapterName: string,
): Record<string, unknown> {
  if (adapterName !== "mongodb") return {};
  return { MongoClient, ObjectId };
}
