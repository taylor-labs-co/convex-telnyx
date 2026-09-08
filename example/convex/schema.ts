import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  notifications: defineTable({
    scope: v.string(),
    eventId: v.string(),
    type: v.string(),
  }).index("by_scope_and_eventId", ["scope", "eventId"]),
});
