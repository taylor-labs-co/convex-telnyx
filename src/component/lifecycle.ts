import { v } from "convex/values";
import type { FunctionHandle } from "convex/server";
import { paginationOptsValidator } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema.js";
import {
  mutation,
  query,
  internalMutation,
  type MutationCtx,
} from "./_generated/server.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { internal } from "./_generated/api.js";
import {
  lifecycleRequest,
  lifecycleDoc,
  lifecycleStatus,
  ownedDoc,
} from "../lifecycle.js";
import { canonical, validatePage } from "../shared.js";

async function owned(
  ctx: MutationCtx,
  scope: string,
  kind: "number" | "profile",
  externalId: string,
) {
  const resource = await ctx.db
    .query("ownedResources")
    .withIndex("by_kind_id", (q) =>
      q.eq("kind", kind).eq("externalId", externalId),
    )
    .unique();
  if (!resource || resource.scope !== scope)
    throw new Error("Resource not owned by scope");
  return resource;
}
async function lock(
  ctx: MutationCtx,
  key: string,
  operationId: Id<"lifecycleOperations">,
) {
  const existing = await ctx.db
    .query("lifecycleLocks")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (existing && existing.operationId !== operationId)
    throw new Error("Resource has an unresolved lifecycle operation");
  if (!existing) await ctx.db.insert("lifecycleLocks", { key, operationId });
}
export const enqueue = mutation({
  args: {
    scope: v.string(),
    key: v.string(),
    request: lifecycleRequest,
    callback: v.optional(v.string()),
  },
  returns: v.id("lifecycleOperations"),
  handler: async (ctx, args) => {
    if (
      !args.scope.trim() ||
      !args.key.trim() ||
      args.scope.length > 256 ||
      args.key.length > 256
    )
      throw new Error("scope and key must contain 1–256 characters");
    const fingerprint = canonical({
      request: args.request,
      callback: args.callback ?? null,
    });
    const old = await ctx.db
      .query("lifecycleOperations")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new Error(
          "Idempotency key already used with different parameters",
        );
      return old._id;
    }
    const r = args.request;
    if (r.kind === "profile") {
      const url = new URL(r.webhookUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          "Use an HTTPS webhook URL without credentials, query or fragment",
        );
      if (!r.name.trim() || r.name.length > 100)
        throw new Error("Profile name must contain 1–100 characters");
    }
    if (r.kind === "number" && !/^\+[1-9]\d{6,14}$/.test(r.phoneNumber))
      throw new Error("Use an E.164 phone number");
    const id = await ctx.db.insert("lifecycleOperations", {
      ...args,
      fingerprint,
      status: "queued",
      submitted: false,
      generation: 0,
      delivered: false,
      updatedAt: Date.now(),
    });
    if (r.kind === "number") {
      const numbers = await ctx.db
        .query("ownedResources")
        .withIndex("by_phone", (q) => q.eq("phoneNumber", r.phoneNumber))
        .collect();
      if (numbers.some((n) => !n.deleted))
        throw new Error("Phone number already owned");
      const profile = await owned(
        ctx,
        args.scope,
        "profile",
        r.messagingProfileId,
      );
      if (profile.deleted) throw new Error("Profile is deleted");
      await lock(ctx, `profile:${r.messagingProfileId}`, id);
      await lock(ctx, `purchase:${r.phoneNumber}`, id);
    } else if (r.kind !== "profile") {
      const kind = r.kind === "deleteProfile" ? "profile" : "number";
      const resource = await owned(ctx, args.scope, kind, r.resourceId);
      await lock(ctx, `${kind}:${r.resourceId}`, id);
      if (
        r.kind === "assignCampaign" &&
        (resource.deleted || resource.phoneNumber !== r.phoneNumber)
      )
        throw new Error("Phone number does not match owned resource");
      if (r.kind === "deleteProfile") {
        const numbers = await ctx.db
          .query("ownedResources")
          .withIndex("by_profile", (q) =>
            q.eq("messagingProfileId", r.resourceId),
          )
          .collect();
        if (numbers.some((n) => !n.deleted))
          throw new Error("Release all owned numbers before deleting profile");
      }
    }
    await ctx.scheduler.runAfter(0, internal.lifecycleWorker.execute, { id });
    return id;
  },
});
export const get = query({
  args: { scope: v.string(), id: v.id("lifecycleOperations") },
  returns: v.union(v.null(), lifecycleDoc),
  handler: async (ctx, { scope, id }) => {
    const op = await ctx.db.get(id);
    return op?.scope === scope ? op : null;
  },
});
export const resources = query({
  args: { scope: v.string() },
  returns: v.array(ownedDoc),
  handler: (ctx, { scope }) =>
    ctx.db
      .query("ownedResources")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .collect(),
});
export const list = query({
  args: { scope: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(lifecycleDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: (ctx, { scope, paginationOpts }) => {
    validatePage(paginationOpts.numItems);
    return paginator(ctx.db, schema)
      .query("lifecycleOperations")
      .withIndex("by_scope", (q) => q.eq("scope", scope))
      .order("desc")
      .paginate(paginationOpts);
  },
});
export const reconcile = mutation({
  args: { scope: v.string(), id: v.id("lifecycleOperations") },
  returns: v.boolean(),
  handler: async (ctx, { scope, id }) => {
    const op = await ctx.db.get(id);
    if (
      !op ||
      op.scope !== scope ||
      (op.status === "failed" && op.noEffect) ||
      !["pending", "uncertain", "failed"].includes(op.status)
    )
      return false;
    await ctx.db.patch(id, { status: "pending" });
    await ctx.scheduler.runAfter(0, internal.lifecycleWorker.execute, { id });
    return true;
  },
});
export const claim = internalMutation({
  args: { id: v.id("lifecycleOperations") },
  returns: v.union(v.null(), lifecycleDoc),
  handler: async (ctx, { id }) => {
    const op = await ctx.db.get(id);
    if (!op || !["queued", "pending"].includes(op.status)) return null;
    const generation = op.generation + 1;
    await ctx.db.patch(id, {
      status: "running",
      submitted: true,
      generation,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(300_000, internal.lifecycle.expire, {
      id,
      generation,
    });
    return { ...op, generation };
  },
});
export const expire = internalMutation({
  args: { id: v.id("lifecycleOperations"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, generation }) => {
    const op = await ctx.db.get(id);
    if (op?.status === "running" && op.generation === generation)
      await ctx.db.patch(id, { status: "uncertain", updatedAt: Date.now() });
    return null;
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("lifecycleOperations"),
    generation: v.number(),
    status: lifecycleStatus,
    reference: v.optional(v.string()),
    resourceId: v.optional(v.string()),
    data: v.optional(v.any()),
    noEffect: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, generation, ...result }) => {
    const op = await ctx.db.get(id);
    if (
      !op ||
      op.generation !== generation ||
      !["running", "uncertain"].includes(op.status)
    )
      return null;
    const r = op.request;
    if (result.status === "succeeded") {
      const externalId =
        result.resourceId ?? ("resourceId" in r ? r.resourceId : undefined);
      if (!externalId) throw new Error("Confirmed resource ID required");
      const kind: "profile" | "number" =
        r.kind === "profile" || r.kind === "deleteProfile"
          ? "profile"
          : "number";
      const existing = await ctx.db
        .query("ownedResources")
        .withIndex("by_kind_id", (q) =>
          q.eq("kind", kind).eq("externalId", externalId),
        )
        .unique();
      if (existing && existing.scope !== op.scope)
        throw new Error("Provider resource already owned by another scope");
      const snapshot = {
        scope: op.scope,
        kind,
        externalId,
        deleted: r.kind === "releaseNumber" || r.kind === "deleteProfile",
        operationId: id,
        data: result.data ?? null,
        updatedAt: Date.now(),
        ...(r.kind === "number"
          ? {
              phoneNumber: r.phoneNumber,
              messagingProfileId: r.messagingProfileId,
            }
          : {}),
      };
      if (existing) await ctx.db.patch(existing._id, snapshot);
      else await ctx.db.insert("ownedResources", snapshot);
    }
    if (
      result.status === "succeeded" ||
      (result.status === "failed" && result.noEffect)
    ) {
      const locks = await ctx.db
        .query("lifecycleLocks")
        .withIndex("by_operation", (q) => q.eq("operationId", id))
        .collect();
      for (const l of locks) await ctx.db.delete(l._id);
    }
    await ctx.db.patch(id, {
      ...result,
      noEffect: result.noEffect ?? false,
      ...(result.noEffect && result.status === "pending"
        ? { submitted: false }
        : {}),
      updatedAt: Date.now(),
    });
    if (result.status === "pending")
      await ctx.scheduler.runAfter(30_000, internal.lifecycleWorker.execute, {
        id,
      });
    if (result.status === "succeeded" && op.callback)
      await ctx.scheduler.runAfter(0, internal.lifecycle.deliver, { id });
    return null;
  },
});
async function deliverCallback(
  ctx: MutationCtx,
  op: Doc<"lifecycleOperations">,
) {
  if (!op.callback || op.delivered || op.status !== "succeeded") return false;
  await ctx.runMutation(op.callback as FunctionHandle<"mutation">, {
    scope: op.scope,
    operationId: op._id,
    snapshot: op,
  });
  await ctx.db.patch(op._id, { delivered: true });
  return true;
}
export const deliver = internalMutation({
  args: { id: v.id("lifecycleOperations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const op = await ctx.db.get(id);
    if (op) await deliverCallback(ctx, op);
    return null;
  },
});
export const redriveCallback = mutation({
  args: { scope: v.string(), id: v.id("lifecycleOperations") },
  returns: v.boolean(),
  handler: async (ctx, { scope, id }) => {
    const op = await ctx.db.get(id);
    return op?.scope === scope ? deliverCallback(ctx, op) : false;
  },
});
