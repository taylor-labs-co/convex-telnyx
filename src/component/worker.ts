import { requestTelnyx, TelnyxRequestError } from "../transport.js";
import { callPaths } from "../callPaths.js";
import { v } from "convex/values";
import {
  action,
  internalAction,
  env,
  type ActionCtx,
} from "./_generated/server.js";
import { internal, api } from "./_generated/api.js";
import { operationDoc } from "./schema.js";
import type { Id, Doc } from "./_generated/dataModel.js";
import { jsonValue, callCommands, messageStatus } from "../shared.js";
/** Provider requests deliberately disable SDK retries: a timeout can mean acceptance. */
export async function executeOperation(
  ctx: ActionCtx,
  id: Id<"operations">,
): Promise<null> {
  const op = await ctx.runMutation(internal.operations.claim, { id });
  if (!op) return null;
  if (!env.TELNYX_API_KEY) {
    await ctx.runMutation(internal.operations.finish, {
      id,
      status: "failed",
      error: {
        message: "TELNYX_API_KEY is not configured on this component instance",
      },
    });
    return null;
  }
  const request = (path: string, body?: unknown, method = "POST") =>
    requestTelnyx(env.TELNYX_API_KEY, path, method, body);
  let response: any;
  try {
    const body = op.request;
    switch (op.method) {
      case "messages.send":
        response = await request("/messages", body);
        break;
      case "messages.sendGroupMms":
        response = await request("/messages/group_mms", body);
        break;
      case "messages.schedule":
        response = await request("/messages/schedule", body);
        break;
      case "messages.cancelScheduled":
        response = await request(
          `/messages/${encodeURIComponent(op.target!)}`,
          undefined,
          "DELETE",
        );
        break;
      case "calls.dial":
        response = await request("/calls", {
          ...body,
          command_id: body.command_id ?? op._id,
        });
        break;
      case "verification.sms":
        response = await request("/verifications/sms", body);
        break;
      case "verification.call":
        response = await request("/verifications/call", body);
        break;
      case "verification.flashcall":
        response = await request("/verifications/flashcall", body);
        break;
      case "verification.whatsapp":
        response = await request("/verifications/whatsapp", body);
        break;
      default: {
        const command = op.method.slice(6);
        if (!callCommands.some((c) => c === command))
          throw new Error("Unsupported call command");
        // Runtime allowlist above is mandatory: never expose arbitrary SDK property access.
        const path = callPaths[command as keyof typeof callPaths];
        const mapped =
          command === "bridge"
            ? {
                ...body,
                call_control_id: body.call_control_id_to_bridge_with,
              }
            : body;
        if (command === "bridge") delete mapped.call_control_id_to_bridge_with;
        response = await request(
          `/calls/${encodeURIComponent(op.target!)}/actions/${path}`,
          { ...mapped, command_id: body.command_id ?? op._id },
          command === "updateClientState" ? "PUT" : "POST",
        );
      }
    }
  } catch (error) {
    const status =
      error instanceof TelnyxRequestError ? error.status : undefined;
    if (status === 429) {
      const retryAfter =
        error instanceof TelnyxRequestError ? error.retryAfter : null;
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const delay = Number.isFinite(seconds)
        ? seconds * 1000
        : retryAfter
          ? Date.parse(retryAfter) - Date.now()
          : 1000 * 2 ** op.attempts;
      await ctx.runMutation(internal.operations.rateLimited, {
        id,
        delay: Number.isFinite(delay) ? delay : 1000 * 2 ** op.attempts,
      });
      return null;
    }
    // Do not retain SDK error bodies: they can echo phone numbers and request secrets.
    const uncertain = status === undefined || status >= 500 || status === 408;
    await ctx.runMutation(internal.operations.finish, {
      id,
      status: uncertain ? "uncertain" : "failed",
      error: jsonValue({
        status,
        message: uncertain
          ? "Provider outcome is unknown. Reconcile with Telnyx before retrying."
          : `Telnyx rejected the request (HTTP ${status}).`,
      }),
    });
    return null;
  }
  // Persistence failures must reach Workpool onComplete, not be treated as API rejection.
  const data = jsonValue(response?.data ?? response ?? null);
  const kind = op.method.startsWith("messages.")
    ? "message"
    : op.method.startsWith("calls.")
      ? "call"
      : "verification";
  const resourceId =
    kind === "call"
      ? (data?.call_control_id ?? op.target)
      : (data?.id ?? op.target);
  if (!op.target && (typeof resourceId !== "string" || !resourceId)) {
    await ctx.runMutation(internal.operations.finish, {
      id,
      status: "uncertain",
      error: {
        message:
          "Provider response was missing its resource ID. Reconcile before retrying.",
      },
    });
    return null;
  }
  if (typeof resourceId === "string") {
    const status =
      kind === "call"
        ? undefined
        : kind === "message"
          ? messageStatus(data)
          : data?.status;
    // Use request time so a webhook arriving before the API response wins.
    await ctx.runMutation(
      api.resources.sync,
      jsonValue({
        scope: op.scope,
        kind,
        externalId: resourceId,
        status,
        at: op.updatedAt,
        data:
          kind === "message"
            ? {
                ...op.request,
                ...data,
                direction: data?.direction ?? "outbound",
              }
            : data,
      }),
    );
  }
  await ctx.runMutation(
    internal.operations.finish,
    jsonValue({ id, status: "succeeded", result: data, resourceId }),
  );
  return null;
}

export const execute = internalAction({
  args: { id: v.id("operations") },
  returns: v.null(),
  handler: async (ctx, { id }) => executeOperation(ctx, id),
});
/** Reserved immediate messages only. Other operations retain their Workpool limits. */
export const sendNow = action({
  args: { scope: v.string(), id: v.id("operations") },
  returns: operationDoc,
  handler: async (ctx, { scope, id }): Promise<Doc<"operations">> => {
    const before = await ctx.runQuery(api.operations.get, { scope, id });
    if (!before || !before.immediate || before.method !== "messages.send")
      throw new Error("Immediate message operation not found in scope");
    await executeOperation(ctx, id);
    const after = await ctx.runQuery(api.operations.get, { scope, id });
    if (!after) throw new Error("Operation not found");
    return after;
  },
});
