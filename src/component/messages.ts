import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { query, mutation } from "./_generated/server.js";
import schema, { resourceDoc, direction } from "./schema.js";
import { validatePage } from "../shared.js";
import { indexMessage, messageRouting } from "./messageIndex.js";
const pageResult = v.object({
  page: v.array(resourceDoc),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
export const listByDirection = query({
  args: {
    scope: v.string(),
    direction,
    paginationOpts: paginationOptsValidator,
  },
  returns: pageResult,
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    return paginator(ctx.db, schema)
      .query("resources")
      .withIndex("by_scope_and_kind_and_direction", (q) =>
        q
          .eq("scope", args.scope)
          .eq("kind", "message")
          .eq("direction", args.direction),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const listByAddress = query({
  args: {
    scope: v.string(),
    role: v.union(
      v.literal("from"),
      v.literal("to"),
      v.literal("counterparty"),
    ),
    address: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: pageResult,
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    const result = await paginator(ctx.db, schema)
      .query("messageContacts")
      .withIndex("by_scope_and_role_and_address", (q) =>
        q
          .eq("scope", args.scope)
          .eq("role", args.role)
          .eq("address", args.address),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    const docs = await Promise.all(
      result.page.map((edge) => ctx.db.get(edge.resourceId)),
    );
    return {
      ...result,
      page: docs.filter(
        (doc): doc is NonNullable<typeof doc> =>
          doc !== null && doc.scope === args.scope,
      ),
    };
  },
});
/** Run page-by-page once when upgrading existing instances; no unbounded scans. */
export const backfillIndexes = mutation({
  args: { scope: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    processed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    const result = await paginator(ctx.db, schema)
      .query("resources")
      .withIndex("by_scope_and_kind", (q) =>
        q.eq("scope", args.scope).eq("kind", "message"),
      )
      .paginate(args.paginationOpts);
    for (const doc of result.page) {
      const routing = messageRouting(doc.data);
      routing.direction ??=
        doc.direction ?? (doc.status === "received" ? "inbound" : undefined);
      await ctx.db.patch(doc._id, routing);
      await indexMessage(ctx, { ...doc, ...routing });
    }
    return {
      processed: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
