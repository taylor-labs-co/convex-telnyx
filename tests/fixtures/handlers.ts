import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";
import { webhookEventValidator } from "../../src/shared.js";
export const processEvent = internalMutationGeneric({
  args: { scope: v.string(), event: webhookEventValidator },
  returns: v.null(),
  handler: async (ctx, { event }) => {
    const toggle = await ctx.db.query("toggles").first();
    // Writing before throwing verifies rollback across the component boundary.
    await ctx.db.insert("hits", { eventId: event.id });
    if (toggle?.fail) throw new Error("intentional callback failure");
    return null;
  },
});
export const messageSent = internalMutationGeneric({
  args: { scope: v.string(), operationId: v.string(), message: v.any() },
  returns: v.null(),
  handler: async (ctx, { message }) => {
    const toggle = await ctx.db.query("toggles").first();
    await ctx.db.insert("hits", { eventId: message.id });
    if (toggle?.fail) throw new Error("intentional send callback failure");
    return null;
  },
});
