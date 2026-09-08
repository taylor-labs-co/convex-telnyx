import { v } from "convex/values";

export const lifecycleRequest = v.union(
  v.object({
    kind: v.literal("profile"),
    name: v.string(),
    webhookUrl: v.string(),
  }),
  v.object({
    kind: v.literal("number"),
    phoneNumber: v.string(),
    messagingProfileId: v.string(),
  }),
  v.object({ kind: v.literal("releaseNumber"), resourceId: v.string() }),
  v.object({ kind: v.literal("deleteProfile"), resourceId: v.string() }),
  v.object({
    kind: v.literal("assignCampaign"),
    resourceId: v.string(),
    phoneNumber: v.string(),
    campaignId: v.string(),
    brandId: v.string(),
  }),
);
export const lifecycleStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("pending"),
  v.literal("uncertain"),
  v.literal("succeeded"),
  v.literal("failed"),
);
export const lifecycleFields = {
  scope: v.string(),
  key: v.string(),
  request: lifecycleRequest,
  fingerprint: v.string(),
  status: lifecycleStatus,
  submitted: v.boolean(),
  noEffect: v.optional(v.boolean()),
  generation: v.number(),
  reference: v.optional(v.string()),
  resourceId: v.optional(v.string()),
  data: v.optional(v.any()),
  callback: v.optional(v.string()),
  delivered: v.boolean(),
  updatedAt: v.number(),
};
export const lifecycleDoc = v.object({
  _id: v.id("lifecycleOperations"),
  _creationTime: v.number(),
  ...lifecycleFields,
});
export const lifecycleSnapshot = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  ...lifecycleFields,
});
export const ownedFields = {
  scope: v.string(),
  kind: v.union(v.literal("number"), v.literal("profile")),
  externalId: v.string(),
  phoneNumber: v.optional(v.string()),
  messagingProfileId: v.optional(v.string()),
  deleted: v.boolean(),
  operationId: v.id("lifecycleOperations"),
  data: v.any(),
  updatedAt: v.number(),
};
export const ownedDoc = v.object({
  _id: v.id("ownedResources"),
  _creationTime: v.number(),
  ...ownedFields,
});
