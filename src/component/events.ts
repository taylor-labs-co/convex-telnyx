import { v } from "convex/values";
import { paginationOptsValidator, type FunctionHandle } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import {
  mutation,
  query,
  internalMutation,
  internalAction,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema, { eventDoc } from "./schema.js";
import {
  webhookEventValidator,
  messageStatus,
  validatePage,
} from "../shared.js";
import { pool } from "./pool.js";
import { upsert } from "./resources.js";
export const ingest = mutation({
  args: {
    scope: v.string(),
    event: webhookEventValidator,
    handler: v.optional(v.string()),
  },
  returns: v.object({ id: v.id("events"), duplicate: v.boolean() }),
  handler: async (ctx, { scope, event, handler }) => {
    const old = await ctx.db
      .query("events")
      .withIndex("by_scope_and_externalId", (q) =>
        q.eq("scope", scope).eq("externalId", event.id),
      )
      .unique();
    if (old) return { id: old._id, duplicate: true };
    const p = event.payload;
    const resourceId =
      typeof p.call_control_id === "string"
        ? p.call_control_id
        : typeof p.id === "string"
          ? p.id
          : undefined;
    const id = await ctx.db.insert("events", {
      scope,
      externalId: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      receivedAt: Date.now(),
      payload: p,
      resourceId,
      handler,
      status: handler ? "pending" : "stored",
    });
    if (resourceId) {
      if (
        ["message.received", "message.sent", "message.finalized"].includes(
          event.type,
        )
      ) {
        const status =
          event.type === "message.received"
            ? "received"
            : (messageStatus(p) ??
              (event.type === "message.sent" ? "sent" : undefined));
        await upsert(ctx, {
          scope,
          kind: "message",
          externalId: resourceId,
          status,
          at: event.occurredAt,
          data: {
            ...p,
            direction:
              p.direction ??
              (event.type === "message.received" ? "inbound" : "outbound"),
          },
        });
      } else if (event.type.startsWith("call.")) {
        const status = (
          {
            "call.initiated": "initiated",
            "call.ringing": "ringing",
            "call.answered": "answered",
            "call.hangup": "hangup",
          } as Record<string, string>
        )[event.type];
        await upsert(ctx, {
          scope,
          kind: "call",
          externalId: resourceId,
          status,
          at: event.occurredAt,
          data: p,
        });
      } else if (event.type.startsWith("verification."))
        await upsert(ctx, {
          scope,
          kind: "verification",
          externalId: resourceId,
          status: p.status,
          at: event.occurredAt,
          data: p,
        });
    }
    if (handler)
      await pool.enqueueAction(
        ctx,
        internal.events.deliverAction,
        { id },
        {
          retry: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
          onComplete: internal.events.onComplete,
          context: { id },
        },
      );
    return { id, duplicate: false };
  },
});
export const deliver = internalMutation({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get(id);
    if (!d?.handler || d.status === "delivered") return null;
    await ctx.runMutation(d.handler as FunctionHandle<"mutation">, {
      scope: d.scope,
      event: {
        id: d.externalId,
        type: d.type,
        occurredAt: d.occurredAt,
        payload: d.payload,
      },
    });
    await ctx.db.patch(id, { status: "delivered", error: undefined });
    return null;
  },
});
export const deliverAction = internalAction({
  args: { id: v.id("events") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.events.deliver, args);
    return null;
  },
});
export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ id: v.id("events") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    const d = await ctx.db.get(context.id);
    if (d && d.status !== "delivered" && result.kind !== "success")
      await ctx.db.patch(d._id, {
        status: "failed",
        error:
          "Application event handler failed after retries. Fix the handler and redrive this event.",
      });
    return null;
  },
});
export const redrive = mutation({
  args: { scope: v.string(), id: v.id("events") },
  returns: v.boolean(),
  handler: async (ctx, { scope, id }) => {
    const d = await ctx.db.get(id);
    if (!d || d.scope !== scope || !d.handler || d.status !== "failed")
      return false;
    await ctx.db.patch(id, { status: "pending", error: undefined });
    await pool.enqueueAction(
      ctx,
      internal.events.deliverAction,
      { id },
      {
        retry: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
        onComplete: internal.events.onComplete,
        context: { id },
      },
    );
    return true;
  },
});
export const list = query({
  args: {
    scope: v.string(),
    resourceId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(eventDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    const p = paginator(ctx.db, schema).query("events");
    return args.resourceId === undefined
      ? p
          .withIndex("by_scope", (q) => q.eq("scope", args.scope))
          .order("desc")
          .paginate(args.paginationOpts)
      : p
          .withIndex("by_scope_and_resourceId", (q) =>
            q.eq("scope", args.scope).eq("resourceId", args.resourceId!),
          )
          .order("desc")
          .paginate(args.paginationOpts);
  },
});
