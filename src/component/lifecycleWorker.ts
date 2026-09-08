import { v } from "convex/values";
import { internalAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { advanceLifecycle } from "../lifecycleProvider.js";
import { jsonValue } from "../shared.js";

export const execute = internalAction({
  args: { id: v.id("lifecycleOperations") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const op = await ctx.runMutation(internal.lifecycle.claim, { id });
    if (!op) return null;
    let result;
    try {
      result = await advanceLifecycle(
        op.request,
        op.reference,
        op.submitted,
        id,
      );
    } catch {
      result = { status: "uncertain" as const };
    }
    // A persistence failure must not be reclassified as a provider rejection.
    await ctx.runMutation(
      internal.lifecycle.finish,
      jsonValue({ id, generation: op.generation, ...result }),
    );
    return null;
  },
});
