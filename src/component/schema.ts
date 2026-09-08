import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { lifecycleFields, ownedFields } from "../lifecycle.js";
export const kind = v.union(
  v.literal("message"),
  v.literal("call"),
  v.literal("verification"),
);
export const operationStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("uncertain"),
  v.literal("canceled"),
);
export const errorValidator = v.object({
  message: v.string(),
  status: v.optional(v.number()),
});
export const callbackStatus = v.union(
  v.literal("pending"),
  v.literal("delivered"),
  v.literal("failed"),
);
export const direction = v.union(v.literal("inbound"), v.literal("outbound"));
export const operationFields = {
  immediate: v.optional(v.boolean()),
  callback: v.optional(v.string()),
  callbackStatus: v.optional(callbackStatus),
  callbackError: v.optional(v.string()),
  callbackWorkId: v.optional(v.string()),
  scope: v.string(),
  key: v.string(),
  method: v.string(),
  request: v.any(),
  fingerprint: v.string(),
  status: operationStatus,
  attempts: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  resourceId: v.optional(v.string()),
  target: v.optional(v.string()),
  workId: v.optional(v.string()),
  result: v.optional(v.any()),
  error: v.optional(errorValidator),
  runAt: v.optional(v.number()),
};
export const resourceFields = {
  from: v.optional(v.string()),
  to: v.optional(v.array(v.string())),
  direction: v.optional(direction),
  scope: v.string(),
  kind,
  externalId: v.string(),
  status: v.string(),
  statusAt: v.number(),
  updatedAt: v.number(),
  data: v.any(),
};
export const eventFields = {
  scope: v.string(),
  externalId: v.string(),
  type: v.string(),
  occurredAt: v.number(),
  receivedAt: v.number(),
  payload: v.any(),
  resourceId: v.optional(v.string()),
  status: v.union(
    v.literal("stored"),
    v.literal("pending"),
    v.literal("delivered"),
    v.literal("failed"),
  ),
  handler: v.optional(v.string()),
  error: v.optional(v.string()),
};
export const operationDoc = v.object({
  _id: v.id("operations"),
  _creationTime: v.number(),
  ...operationFields,
});
export const resourceDoc = v.object({
  _id: v.id("resources"),
  _creationTime: v.number(),
  ...resourceFields,
});
export const eventDoc = v.object({
  _id: v.id("events"),
  _creationTime: v.number(),
  ...eventFields,
});
export default defineSchema({
  lifecycleOperations: defineTable(lifecycleFields)
    .index("by_scope_key", ["scope", "key"])
    .index("by_scope", ["scope"]),
  ownedResources: defineTable(ownedFields)
    .index("by_phone", ["phoneNumber"])
    .index("by_kind_id", ["kind", "externalId"])
    .index("by_scope", ["scope"])
    .index("by_profile", ["messagingProfileId"]),
  lifecycleLocks: defineTable({
    key: v.string(),
    operationId: v.id("lifecycleOperations"),
  })
    .index("by_key", ["key"])
    .index("by_operation", ["operationId"]),
  messageContacts: defineTable({
    scope: v.string(),
    resourceId: v.id("resources"),
    role: v.union(
      v.literal("from"),
      v.literal("to"),
      v.literal("counterparty"),
    ),
    address: v.string(),
  })
    .index("by_resourceId", ["resourceId"])
    .index("by_scope_and_role_and_address", ["scope", "role", "address"]),
  messagingProfiles: defineTable({
    scope: v.string(),
    externalId: v.string(),
    webhookUrl: v.string(),
    webhookFailoverUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_scope_and_externalId", ["scope", "externalId"]),
  phoneNumbers: defineTable({
    scope: v.string(),
    externalId: v.string(),
    phoneNumber: v.optional(v.string()),
    messagingProfileId: v.string(),
    updatedAt: v.number(),
  }).index("by_scope_and_externalId", ["scope", "externalId"]),
  operations: defineTable(operationFields)
    .index("by_scope_and_key", ["scope", "key"])
    .index("by_scope", ["scope"])
    .index("by_scope_and_status", ["scope", "status"]),
  resources: defineTable(resourceFields)
    .index("by_scope_and_kind_and_externalId", ["scope", "kind", "externalId"])
    .index("by_scope_and_kind", ["scope", "kind"])
    .index("by_scope_and_kind_and_direction", ["scope", "kind", "direction"]),
  events: defineTable(eventFields)
    .index("by_scope_and_externalId", ["scope", "externalId"])
    .index("by_scope", ["scope"])
    .index("by_scope_and_resourceId", ["scope", "resourceId"])
    .index("by_scope_and_status", ["scope", "status"]),
});
