import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
/** Redact payloads without deleting idempotency tombstones or event deduplication IDs. */
export const redact = mutation({
  args: {
    scope: v.string(),
    operationIds: v.optional(v.array(v.id("operations"))),
    eventIds: v.optional(v.array(v.id("events"))),
    resourceIds: v.optional(v.array(v.id("resources"))),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    if (
      (args.operationIds?.length ?? 0) +
        (args.eventIds?.length ?? 0) +
        (args.resourceIds?.length ?? 0) >
      100
    )
      throw new Error("Redact at most 100 records per mutation");
    let count = 0;
    for (const id of args.operationIds ?? []) {
      const d = await ctx.db.get(id);
      if (
        d?.scope === args.scope &&
        !["queued", "running"].includes(d.status) &&
        !["pending", "failed"].includes(d.callbackStatus ?? "")
      ) {
        await ctx.db.patch(id, {
          request: null,
          result: undefined,
          error: undefined,
          callback: undefined,
          callbackError: undefined,
        });
        count++;
      }
    }
    for (const id of args.eventIds ?? []) {
      const d = await ctx.db.get(id);
      if (
        d?.scope === args.scope &&
        ["stored", "delivered"].includes(d.status)
      ) {
        await ctx.db.patch(id, {
          payload: {},
          handler: undefined,
          error: undefined,
        });
        count++;
      }
    }
    for (const id of args.resourceIds ?? []) {
      const d = await ctx.db.get(id);
      if (d?.scope === args.scope) {
        const contacts = await ctx.db
          .query("messageContacts")
          .withIndex("by_resourceId", (q) => q.eq("resourceId", id))
          .take(62);
        for (const contact of contacts) await ctx.db.delete(contact._id);
        await ctx.db.patch(id, { data: {}, from: undefined, to: undefined });
        count++;
      }
    }
    return count;
  },
});
