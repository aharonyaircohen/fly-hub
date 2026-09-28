import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { requireServiceKey } from "./lib/auth";
import { resetQaPassword } from "./qaUserProvisioning";

import { authComponent, createAuth } from "./betterAuth/auth";

const http = httpRouter();

http.route({
  path: "/internal/qa/reset-password",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    requireServiceKey(request.headers.get("x-kody-service-key") ?? undefined);
    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
      password?: unknown;
    } | null;
    if (
      typeof body?.email !== "string" ||
      typeof body.password !== "string" ||
      !body.email.trim() ||
      !body.password
    ) {
      return Response.json(
        { error: "Valid QA credentials are required" },
        { status: 400 },
      );
    }
    const auth = createAuth(ctx);
    const authContext = await auth.$context;
    await resetQaPassword(authContext, body.email.trim(), body.password);
    return Response.json({ ok: true });
  }),
});

authComponent.registerRoutes(http, createAuth);

export default http;
