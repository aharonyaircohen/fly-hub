import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const kodyAuthClient = createAuthClient({
  plugins: [convexClient()],
});
