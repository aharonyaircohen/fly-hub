import { internalAction } from "./_generated/server";
import { createQaProvisioningAuth } from "./betterAuth/auth";

export async function resetQaPassword(
  authContext: {
    internalAdapter: {
      findUserByEmail(email: string): Promise<{ user?: { id: string } } | null>;
      updatePassword(userId: string, hash: string): Promise<unknown>;
    };
    password: { hash(password: string): Promise<string> };
  },
  email: string,
  password: string,
) {
  const found = await authContext.internalAdapter.findUserByEmail(email);
  if (!found?.user) throw new Error("QA user does not exist");
  const hash = await authContext.password.hash(password);
  await authContext.internalAdapter.updatePassword(found.user.id, hash);
}

/**
 * Create the dedicated QA user without opening public registration.
 * Credentials are read from temporary Convex environment values so they are
 * never passed as action arguments or written to logs.
 */
export const provision = internalAction({
  args: {},
  handler: async (ctx) => {
    const email = process.env.QA_PROVISION_LOGIN_USER?.trim();
    const password = process.env.QA_PROVISION_LOGIN_PASSWORD;
    if (!email || !password) {
      throw new Error("QA provisioning credentials are not configured");
    }

    const auth = createQaProvisioningAuth(ctx);
    try {
      await auth.api.signInEmail({ body: { email, password } });
      return { ok: true, created: false };
    } catch {
      await auth.api.signUpEmail({
        body: { email, password, name: "Kody QA" },
      });
      return { ok: true, created: true };
    }
  },
});

/** Remove a failed provisioning attempt; email is supplied temporarily in env. */
export const removeOrphan = internalAction({
  args: {},
  handler: async (ctx) => {
    const email = process.env.QA_PROVISION_DELETE_USER?.trim();
    if (!email) throw new Error("QA cleanup email is not configured");
    const auth = createQaProvisioningAuth(ctx);
    const authContext = await auth.$context;
    const found = await authContext.internalAdapter.findUserByEmail(email);
    if (!found?.user) return { ok: true, removed: false };
    await authContext.internalAdapter.deleteUser(found.user.id);
    return { ok: true, removed: true };
  },
});
