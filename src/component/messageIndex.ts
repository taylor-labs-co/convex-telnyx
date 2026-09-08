import type { MutationCtx } from "./_generated/server.js";
import type { Doc } from "./_generated/dataModel.js";
function address(value: any): string | undefined {
  const s = typeof value === "string" ? value : value?.phone_number;
  return typeof s === "string" && s.length > 0 ? s : undefined;
}
export function messageDirection(
  data: any,
): "inbound" | "outbound" | undefined {
  if (data?.direction === "inbound" || data?.direction === "incoming")
    return "inbound";
  if (data?.direction === "outbound" || data?.direction === "outgoing")
    return "outbound";
  return undefined;
}
/** One edge per message/role/address keeps group conversations duplicate-free. */
export async function indexMessage(
  ctx: MutationCtx,
  resource: Doc<"resources">,
) {
  if (resource.kind !== "message") return;
  const existing = await ctx.db
    .query("messageContacts")
    .withIndex("by_resourceId", (q) => q.eq("resourceId", resource._id))
    .take(62);
  const from = resource.from;
  const to = resource.to ?? [];
  if (to.length > 20)
    throw new Error("Message indexing supports at most 20 recipients");
  const edges: Array<{
    role: "from" | "to" | "counterparty";
    address: string;
  }> = [];
  if (from) edges.push({ role: "from", address: from });
  for (const s of to) edges.push({ role: "to", address: s });
  const counterparties =
    resource.direction === "inbound"
      ? from
        ? [from]
        : []
      : resource.direction === "outbound"
        ? to
        : [];
  for (const s of counterparties)
    edges.push({ role: "counterparty", address: s });
  const key = (e: { role: string; address: string }) =>
    JSON.stringify([e.role, e.address]);
  const desired = new Set(edges.map(key)),
    old = new Set(existing.map(key));
  for (const e of existing)
    if (!desired.has(key(e))) await ctx.db.delete(e._id);
  for (const e of edges)
    if (!old.has(key(e)))
      await ctx.db.insert("messageContacts", {
        scope: resource.scope,
        resourceId: resource._id,
        ...e,
      });
}

export function messageRouting(data: any) {
  const recipients: unknown[] = Array.isArray(data?.to) ? data.to : [data?.to];
  const to = [
    ...new Set(recipients.map(address).filter((s): s is string => !!s)),
  ];
  if (to.length > 20)
    throw new Error("Message indexing supports at most 20 recipients");
  return {
    direction: messageDirection(data),
    from: address(data?.from),
    to: to.length ? to : undefined,
  };
}
