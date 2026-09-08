import {
  Telnyx,
  webhookEventValidator,
  sentMessageCallbackArgs,
} from "convex-telnyx";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { components } from "./_generated/api.js";
import {
  mutation,
  action,
  internalAction,
  query,
  internalMutation,
  type QueryCtx,
} from "./_generated/server.js";
export const telnyx = new Telnyx(components.telnyx, {
  defaultFrom: process.env.TELNYX_FROM_NUMBER,
});
// This example uses one workspace shared by authenticated members. For SaaS,
// check membership and derive the workspace ID from your own authorization tables.
async function authorizedScope(ctx: Pick<QueryCtx, "auth">) {
  if (!(await ctx.auth.getUserIdentity())) throw new Error("Sign in first");
  return "demo-workspace";
}
export const send = mutation({
  args: { to: v.string(), text: v.string(), requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const scope = await authorizedScope(ctx);
    const from = process.env.TELNYX_FROM_NUMBER;
    if (!from) throw new Error("Set TELNYX_FROM_NUMBER");
    return telnyx.sendMessage(
      ctx,
      { to: args.to, from, text: args.text },
      { scope, idempotencyKey: args.requestId },
    );
  },
});
export const dial = mutation({
  args: { to: v.string(), requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const scope = await authorizedScope(ctx);
    const from = process.env.TELNYX_FROM_NUMBER,
      connection_id = process.env.TELNYX_CONNECTION_ID;
    if (!from || !connection_id)
      throw new Error("Set TELNYX_FROM_NUMBER and TELNYX_CONNECTION_ID");
    return telnyx.dial(
      ctx,
      { to: args.to, from, connection_id },
      { scope, idempotencyKey: args.requestId },
    );
  },
});
export const hangup = mutation({
  args: { callControlId: v.string(), requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) =>
    telnyx.callCommand(
      ctx,
      args.callControlId,
      "hangup",
      {},
      { scope: await authorizedScope(ctx), idempotencyKey: args.requestId },
    ),
});
export const operations = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) =>
    telnyx.listOperations(ctx, await authorizedScope(ctx), args.paginationOpts),
});
export const calls = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) =>
    telnyx.listCalls(ctx, await authorizedScope(ctx), args.paginationOpts),
});
export const messages = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) =>
    telnyx.listMessages(ctx, await authorizedScope(ctx), args.paginationOpts),
});
export const onEvent = internalMutation({
  args: { scope: v.string(), event: webhookEventValidator },
  returns: v.null(),
  handler: async (ctx, { scope, event }) => {
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_scope_and_eventId", (q) =>
        q.eq("scope", scope).eq("eventId", event.id),
      )
      .unique();
    if (!old)
      await ctx.db.insert("notifications", {
        scope,
        eventId: event.id,
        type: event.type,
      });
    return null;
  },
});

// Run from the dashboard/CLI only after choosing an owned phone number/profile.
export const configureIncoming = internalAction({
  args: { phoneNumberId: v.string(), messagingProfileId: v.string() },
  returns: v.object({
    phoneNumberId: v.string(),
    messagingProfileId: v.string(),
    webhookUrl: v.string(),
  }),
  handler: async (ctx, args) =>
    telnyx.registerIncomingSmsHandler(ctx, {
      ...args,
      scope: "demo-workspace",
    }),
});
export const sendImmediately = action({
  args: { to: v.string(), text: v.string(), requestId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) =>
    telnyx.sendMessageNow(
      ctx,
      { to: args.to, text: args.text },
      { scope: await authorizedScope(ctx), idempotencyKey: args.requestId },
    ),
});
export const conversation = query({
  args: { phoneNumber: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.any(),
  handler: async (ctx, args) =>
    telnyx.getMessagesByCounterparty(
      ctx,
      await authorizedScope(ctx),
      args.phoneNumber,
      args.paginationOpts,
    ),
});
export const onMessageSent = internalMutation({
  args: sentMessageCallbackArgs,
  returns: v.null(),
  handler: async (ctx, { scope, operationId }) => {
    const eventId = `sent:${operationId}`;
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_scope_and_eventId", (q) =>
        q.eq("scope", scope).eq("eventId", eventId),
      )
      .unique();
    if (!old)
      await ctx.db.insert("notifications", {
        scope,
        eventId,
        type: "message.submitted",
      });
    return null;
  },
});
