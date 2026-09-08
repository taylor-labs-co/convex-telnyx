import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
/** These snapshots are recorded only after the provider confirms each API update. */
export const saveProfile = mutation({
  args: {
    scope: v.string(),
    externalId: v.string(),
    webhookUrl: v.string(),
    webhookFailoverUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("messagingProfiles")
      .withIndex("by_scope_and_externalId", (q) =>
        q.eq("scope", args.scope).eq("externalId", args.externalId),
      )
      .unique();
    const doc = {
      ...args,
      webhookFailoverUrl: args.webhookFailoverUrl ?? old?.webhookFailoverUrl,
      updatedAt: Date.now(),
    };
    if (old) await ctx.db.replace(old._id, doc);
    else await ctx.db.insert("messagingProfiles", doc);
    return null;
  },
});
export const saveNumber = mutation({
  args: {
    scope: v.string(),
    externalId: v.string(),
    phoneNumber: v.optional(v.string()),
    messagingProfileId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("phoneNumbers")
      .withIndex("by_scope_and_externalId", (q) =>
        q.eq("scope", args.scope).eq("externalId", args.externalId),
      )
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (old) await ctx.db.replace(old._id, doc);
    else await ctx.db.insert("phoneNumbers", doc);
    return null;
  },
});
export const getProfile = query({
  args: { scope: v.string(), externalId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("messagingProfiles"),
      _creationTime: v.number(),
      scope: v.string(),
      externalId: v.string(),
      webhookUrl: v.string(),
      webhookFailoverUrl: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) =>
    ctx.db
      .query("messagingProfiles")
      .withIndex("by_scope_and_externalId", (q) =>
        q.eq("scope", args.scope).eq("externalId", args.externalId),
      )
      .unique(),
});
export const getNumber = query({
  args: { scope: v.string(), externalId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("phoneNumbers"),
      _creationTime: v.number(),
      scope: v.string(),
      externalId: v.string(),
      phoneNumber: v.optional(v.string()),
      messagingProfileId: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) =>
    ctx.db
      .query("phoneNumbers")
      .withIndex("by_scope_and_externalId", (q) =>
        q.eq("scope", args.scope).eq("externalId", args.externalId),
      )
      .unique(),
});
