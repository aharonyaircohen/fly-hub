import {
  listAppsByPrefix,
  type FlyPreviewConfig,
} from "../plugin/previews/machines-client";
import { appNamePattern } from "../../builder/src/app-image-format";
import { runtimeAppName } from "../../builder/src/app-builder-names";

export class AppOwnershipError extends Error {
  readonly status = 404;
}

export async function assertFlyHubAppOwned(
  app: string,
  cfg: FlyPreviewConfig,
  options: { allowRuntimeOnly?: boolean } = {},
) {
  if (!appNamePattern.test(app))
    throw new AppOwnershipError("App not found in this Fly organization.");
  const owned = await listAppsByPrefix("flyhub-app-", cfg);
  if (
    !owned.includes(app) &&
    !(options.allowRuntimeOnly && owned.includes(runtimeAppName(app)))
  )
    throw new AppOwnershipError("App not found in this Fly organization.");
  return owned;
}
