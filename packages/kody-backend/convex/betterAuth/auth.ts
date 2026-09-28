import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import authConfig from "../auth.config";
import { authSiteUrl, authTrustedOrigins } from "./trustedOrigins";

import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

export const authComponent = createClient<DataModel>(components.betterAuth);

export function emailPasswordOptions(
  options: { allowSignUp?: boolean } = {},
): NonNullable<BetterAuthOptions["emailAndPassword"]> {
  return {
    enabled: true,
    disableSignUp: !options.allowSignUp,
    requireEmailVerification: false,
  };
}

function socialProviders(): BetterAuthOptions["socialProviders"] {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

  return {
    ...(googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : {}),
    ...(githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          },
        }
      : {}),
  };
}

function createAuthWithOptions(
  ctx: GenericCtx<DataModel>,
  options: { allowEmailSignUp?: boolean } = {},
) {
  return betterAuth({
    appName: "Kody",
    baseURL: authSiteUrl(process.env),
    trustedOrigins: authTrustedOrigins(process.env),
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    socialProviders: socialProviders(),
    emailAndPassword: emailPasswordOptions({
      allowSignUp: options.allowEmailSignUp,
    }),
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
      },
    },
    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 0,
    },
    plugins: [convex({ authConfig })],
  });
}

export function createAuth(ctx: GenericCtx<DataModel>) {
  return createAuthWithOptions(ctx);
}

/** Used only by the internal, CLI-invoked QA account provisioner. */
export function createQaProvisioningAuth(ctx: GenericCtx<DataModel>) {
  return createAuthWithOptions(ctx, { allowEmailSignUp: true });
}
