import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import {
  internalMutation,
  internalAction,
  mutation,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { operationPool } from "./pool.js";
/** Callback writes and delivered marker are atomic; the provider send is never replayed. */
export const deliver = internalMutation({
  args: { id: v.id("operations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const op = await ctx.db.get(id);
    if (
      !op?.callback ||
      op.status !== "succeeded" ||
      op.callbackStatus === "delivered"
    )
      return null;
    await ctx.runMutation(op.callback as FunctionHandle<"mutation">, {
      scope: op.scope,
      operationId: id,
      message: op.result,
    });
    await ctx.db.patch(id, {
      callbackStatus: "delivered",
      callbackError: undefined,
    });
    return null;
  },
});
export const deliverAction = internalAction({
  args: { id: v.id("operations") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(internal.callbacks.deliver, args);
    return null;
  },
});
export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ id: v.id("operations") })),
  returns: v.null(),
  handler: async (ctx, { workId, context, result }) => {
    const op = await ctx.db.get(context.id);
    if (
      op?.callbackWorkId === workId &&
      op.callbackStatus !== "delivered" &&
      result.kind !== "success"
    )
      await ctx.db.patch(op._id, {
        callbackStatus: "failed",
        callbackError:
          "Submission callback failed after retries. Redrive the callback after fixing the handler.",
      });
    return null;
  },
});
export const redrive = mutation({
  args: { scope: v.string(), id: v.id("operations") },
  returns: v.boolean(),
  handler: async (ctx, { scope, id }) => {
    const op = await ctx.db.get(id);
    if (
      !op ||
      op.scope !== scope ||
      !op.callback ||
      op.status !== "succeeded" ||
      op.callbackStatus !== "failed"
    )
      return false;
    await ctx.db.patch(id, {
      callbackStatus: "pending",
      callbackError: undefined,
    });
    const callbackWorkId = await operationPool(op.method).enqueueAction(
      ctx,
      internal.callbacks.deliverAction,
      { id },
      {
        retry: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
        onComplete: internal.callbacks.onComplete,
        context: { id },
      },
    );
    await ctx.db.patch(id, { callbackWorkId });
    return true;
  },
});
