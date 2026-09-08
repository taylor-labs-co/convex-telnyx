import { v } from "convex/values";
import { vOnCompleteArgs } from "@convex-dev/workpool";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { mutation, query, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema, {
  operationDoc,
  operationStatus,
  errorValidator,
} from "./schema.js";
import { canonical, validateOperation, validatePage } from "../shared.js";
import { operationPool } from "./pool.js";
export const enqueue = mutation({
  args: {
    scope: v.string(),
    key: v.string(),
    method: v.string(),
    request: v.any(),
    target: v.optional(v.string()),
    runAt: v.optional(v.number()),
    callback: v.optional(v.string()),
    immediate: v.optional(v.boolean()),
  },
  returns: v.id("operations"),
  handler: async (ctx, args) => {
    if (
      !args.scope.trim() ||
      !args.key.trim() ||
      args.key.length > 256 ||
      args.scope.length > 256
    )
      throw new Error("scope and key must contain 1–256 characters");
    validateOperation(args.method, args.request, args.target);
    const fingerprint = bytesToHex(
      sha256(
        new TextEncoder().encode(
          canonical({
            method: args.method,
            request: args.request,
            target: args.target ?? null,
            runAt: args.runAt ?? null,
            callback: args.callback ?? null,
            immediate: args.immediate ?? false,
          }),
        ),
      ),
    );
    const existing = await ctx.db
      .query("operations")
      .withIndex("by_scope_and_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error(
          "Idempotency key already used with different parameters",
        );
      return existing._id;
    }
    if (
      args.runAt !== undefined &&
      (!Number.isFinite(args.runAt) || args.runAt < Date.now() - 1000)
    )
      throw new Error("runAt must be a future timestamp in milliseconds");
    if (
      args.immediate &&
      (args.method !== "messages.send" || args.runAt !== undefined)
    )
      throw new Error(
        "Immediate sending supports unscheduled messages.send only",
      );
    if (
      args.callback &&
      !["messages.send", "messages.sendGroupMms", "messages.schedule"].includes(
        args.method,
      )
    )
      throw new Error("Submission callbacks apply only to message sends");
    if (args.target) {
      const kind = args.method.startsWith("calls.") ? "call" : "message";
      const target = await ctx.db
        .query("resources")
        .withIndex("by_scope_and_kind_and_externalId", (q) =>
          q
            .eq("scope", args.scope)
            .eq("kind", kind)
            .eq("externalId", args.target!),
        )
        .unique();
      if (!target)
        throw new Error(
          "Target resource not found in scope; ingest its webhook or sync it first",
        );
    }
    const id = await ctx.db.insert("operations", {
      ...args,
      fingerprint,
      status: "queued",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (args.immediate) {
      await ctx.scheduler.runAfter(
        60_000,
        internal.operations.expireImmediate,
        { id },
      );
      return id;
    }
    const workId = await operationPool(args.method).enqueueAction(
      ctx,
      internal.worker.execute,
      { id },
      {
        retry: false,
        runAt: args.runAt,
        onComplete: internal.operations.onComplete,
        context: { id },
      },
    );
    await ctx.db.patch(id, { workId });
    return id;
  },
});
export const get = query({
  args: { scope: v.string(), id: v.id("operations") },
  returns: v.union(v.null(), operationDoc),
  handler: async (ctx, { scope, id }) => {
    const d = await ctx.db.get(id);
    return d?.scope === scope ? d : null;
  },
});
export const list = query({
  args: {
    scope: v.string(),
    status: v.optional(operationStatus),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(operationDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    validatePage(args.paginationOpts.numItems);
    const p = paginator(ctx.db, schema).query("operations");
    return args.status === undefined
      ? p
          .withIndex("by_scope", (q) => q.eq("scope", args.scope))
          .order("desc")
          .paginate(args.paginationOpts)
      : p
          .withIndex("by_scope_and_status", (q) =>
            q.eq("scope", args.scope).eq("status", args.status!),
          )
          .order("desc")
          .paginate(args.paginationOpts);
  },
});
export const cancel = mutation({
  args: { scope: v.string(), id: v.id("operations") },
  returns: v.boolean(),
  handler: async (ctx, { scope, id }) => {
    const d = await ctx.db.get(id);
    if (!d || d.scope !== scope || d.status !== "queued") return false;
    await ctx.db.patch(id, {
      status: "canceled",
      request: null,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const claim = internalMutation({
  args: { id: v.id("operations") },
  returns: v.union(v.null(), operationDoc),
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get(id);
    if (!d || d.status !== "queued") return null;
    await ctx.db.patch(id, {
      status: "running",
      attempts: d.attempts + 1,
      updatedAt: Date.now(),
    });
    return { ...d, status: "running" as const, attempts: d.attempts + 1 };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("operations"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("uncertain"),
    ),
    result: v.optional(v.any()),
    error: v.optional(errorValidator),
    resourceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, ...patch }) => {
    const d = await ctx.db.get(id);
    if (d?.status === "running") {
      await ctx.db.patch(id, {
        ...patch,
        request: null,
        updatedAt: Date.now(),
      });
      if (patch.status === "succeeded" && d.callback) {
        await ctx.db.patch(id, { callbackStatus: "pending" });
        const callbackWorkId = await operationPool(d.method).enqueueAction(
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
      }
    }
    return null;
  },
});
export const rateLimited = internalMutation({
  args: { id: v.id("operations"), delay: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, delay }) => {
    const d = await ctx.db.get(id);
    if (!d || d.status !== "running") return null;
    if (d.immediate) {
      await ctx.db.patch(id, {
        status: "failed",
        request: null,
        error: {
          message:
            "Immediate send was rate limited; it was not queued or retried",
          status: 429,
        },
        updatedAt: Date.now(),
      });
      return null;
    }
    if (!Number.isFinite(delay) || delay > 86_400_000) {
      await ctx.db.patch(id, {
        status: "failed",
        request: null,
        error: {
          message: "Retry-After exceeds the one-day automatic retry window",
          status: 429,
        },
        updatedAt: Date.now(),
      });
      return null;
    }
    if (d.attempts >= 5) {
      await ctx.db.patch(id, {
        status: "failed",
        request: null,
        error: { message: "Rate limit retry budget exhausted", status: 429 },
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch(id, { status: "queued", updatedAt: Date.now() });
    const workId = await operationPool(d.method).enqueueAction(
      ctx,
      internal.worker.execute,
      { id },
      {
        runAfter: Math.max(1000, delay),
        retry: false,
        onComplete: internal.operations.onComplete,
        context: { id },
      },
    );
    await ctx.db.patch(id, { workId });
    return null;
  },
});
export const onComplete = internalMutation({
  args: vOnCompleteArgs(v.object({ id: v.id("operations") })),
  returns: v.null(),
  handler: async (ctx, { workId, context, result }) => {
    const d = await ctx.db.get(context.id);
    if (
      d?.workId === workId &&
      result.kind !== "success" &&
      ["running", "queued"].includes(d.status)
    )
      await ctx.db.patch(d._id, {
        status: d.status === "running" ? "uncertain" : "failed",
        request: null,
        error: {
          message:
            d.status === "running"
              ? "Worker stopped before confirming the provider outcome. Reconcile before retrying."
              : "Worker failed before starting the provider request.",
        },
        updatedAt: Date.now(),
      });
    return null;
  },
});

/** A caller may disappear after reservation or after sending: never resend on expiry. */
export const expireImmediate = internalMutation({
  args: { id: v.id("operations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get(id);
    if (!d?.immediate || !["queued", "running"].includes(d.status)) return null;
    await ctx.db.patch(id, {
      status: d.status === "running" ? "uncertain" : "failed",
      request: null,
      updatedAt: Date.now(),
      error: {
        message:
          d.status === "running"
            ? "Immediate send did not confirm its result. Reconcile before retrying."
            : "Immediate send was reserved but never started.",
      },
    });
    return null;
  },
});
