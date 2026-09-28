import "server-only";

import { resolvePersonalBrainContext } from "@kody-ade/brain/personal-context";
import { withPersonalBrainUser } from "./personal-services";

export function resolvePersonalBrainContextForUser(
  userId: string,
  request?: Request,
) {
  return withPersonalBrainUser(userId, () =>
    resolvePersonalBrainContext(request),
  );
}
