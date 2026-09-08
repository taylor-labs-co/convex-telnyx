import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { query, mutation, type MutationCtx } from "./_generated/server.js";
import { validatePage } from "../shared.js";
import { indexMessage, messageRouting } from "./messageIndex.js";
import schema, { kind, resourceDoc } from "./schema.js";
export async function upsert(
  ctx: MutationCtx,
  args: {
    scope: string;
    kind: "message" | "call" | "verification";
    externalId: string;
    status?: string;
    at: number;
    data: any;
  },
) {
  const d = await ctx.db
    .query("resources")
    .withIndex("by_scope_and_kind_and_externalId", (q) =>
      q
        .eq("scope", args.scope)
        .eq("kind", args.kind)
        .eq("externalId", args.externalId),
    )
    .unique();
  if (!d) {
    const id = await ctx.db.insert("resources", {
      ...(args.kind === "message" ? { ...messageRouting(args.data) } : {}),
      scope: args.scope,
      kind: args.kind,
      externalId: args.externalId,
      status: args.status ?? "unknown",
      statusAt: args.status ? args.at : 0,
      updatedAt: args.at,
      data: args.data,
    });
    await indexMessage(ctx, (await ctx.db.get(id))!);
    return;
  }
  const terminal = (s: string) =>
    [
      "delivered",
      "partially_delivered",
      "delivery_failed",
      "sending_failed",
      "failed",
      "canceled",
      "hangup",
      "accepted",
      "rejected",
      "expired",
    ].includes(s);
  const advance =
    args.status &&
    args.at >= d.statusAt &&
    (!terminal(d.status) || terminal(args.status));
  // Older responses may fill missing immutable routing fields, but cannot replace newer data.
  const data =
    args.at >= d.updatedAt
      ? { ...d.data, ...args.data }
      : { ...args.data, ...d.data };
  await ctx.db.patch(d._id, {
    data,
    ...(args.kind === "message"
      ? {
          direction: messageRouting(data).direction ?? d.direction,
          from: messageRouting(data).from ?? d.from,
          to: messageRouting(data).to ?? d.to,
        }
      : {}),
    updatedAt: Math.max(args.at, d.updatedAt),
    ...(advance ? { status: args.status, statusAt: args.at } : {}),
  });
  await indexMessage(ctx, (await ctx.db.get(d._id))!);
}
/** Parent-only synchronization entrypoint for SDK reads. Authorize before calling. */
export const sync = mutation({
  args: {
    scope: v.string(),
    kind,
    externalId: v.string(),
    status: v.optional(v.string()),
    at: v.number(),
    data: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsert(ctx, args);
    return null;
  },
});
export const get = query({
  args: { scope: v.string(), kind, externalId: v.string() },
  returns: v.union(v.null(), resourceDoc),
  handler: async (ctx, args) =>
    ctx.db
      .query("resources")
      .withIndex("by_scope_and_kind_and_externalId", (q) =>
        q
          .eq("scope", args.scope)
          .eq("kind", args.kind)
          .eq("externalId", args.externalId),
      )
      .unique(),
});
export const list = query({
  args: { scope: v.string(), kind, paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(resourceDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    return paginator(ctx.db, schema)
      .query("resources")
      .withIndex("by_scope_and_kind", (q) =>
        q.eq("scope", args.scope).eq("kind", args.kind),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
