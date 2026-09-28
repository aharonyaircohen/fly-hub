import { query } from "./_generated/server";

export const currentUser = query({
  args: {},
  handler: async (ctx) => await ctx.auth.getUserIdentity(),
});
