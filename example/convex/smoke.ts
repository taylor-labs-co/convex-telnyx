import { internalMutation } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";
/** Offline-safe deployment check: no provider request and no Telnyx credentials. */
export const check = internalMutation({
  args: {},
  returns: v.object({
    component: v.boolean(),
    deduplication: v.boolean(),
    reactiveState: v.boolean(),
  }),
  handler: async (ctx) => {
    const event = {
      id: "smoke-inbound",
      type: "message.received",
      occurredAt: 1000,
      payload: { id: "smoke-message", text: "local smoke test" },
    };
    await ctx.runMutation(components.telnyx.events.ingest, {
      scope: "__smoke__",
      event,
    });
    const duplicate = await ctx.runMutation(components.telnyx.events.ingest, {
      scope: "__smoke__",
      event,
    });
    const message = await ctx.runQuery(components.telnyx.resources.get, {
      scope: "__smoke__",
      kind: "message",
      externalId: "smoke-message",
    });
    return {
      component: !!message,
      deduplication: duplicate.duplicate,
      reactiveState: message?.status === "received",
    };
  },
});
