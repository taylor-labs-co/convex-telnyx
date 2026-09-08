import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  createFunctionHandle,
  defineSchema,
  defineTable,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import schema from "../src/component/schema.js";
import { api, internal } from "../src/component/_generated/api.js";
import { modules } from "../src/test.js";
import { advanceLifecycle } from "../src/lifecycleProvider.js";

vi.mock("../src/lifecycleProvider.js", () => ({ advanceLifecycle: vi.fn() }));
const provider = vi.mocked(advanceLifecycle);
const profile = {
  kind: "profile" as const,
  name: "Messaging",
  webhookUrl: "https://example.com/webhook",
};
const number = {
  kind: "number" as const,
  phoneNumber: "+15551234567",
  messagingProfileId: "profile-1",
};
const lifecycle = api.lifecycle;
const worker = internal.lifecycle;
function setup() {
  return convexTest(schema, modules);
}
type Test = ReturnType<typeof setup>;
async function enqueue(
  t: Test,
  key: string,
  request = profile,
  scope = "scope",
) {
  return t.mutation(lifecycle.enqueue, { scope, key, request });
}
async function succeed(
  t: Test,
  id: Awaited<ReturnType<typeof enqueue>>,
  resourceId?: string,
) {
  const claim = await t.mutation(worker.claim, { id });
  expect(claim).not.toBeNull();
  await t.mutation(worker.finish, {
    id,
    generation: claim!.generation,
    status: "succeeded",
    ...(resourceId ? { resourceId } : {}),
  });
}
async function ownProfile(t: Test) {
  const id = await enqueue(t, "profile");
  await succeed(t, id, "profile-1");
  return id;
}
beforeEach(() => {
  vi.useFakeTimers();
  provider.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("deduplicates concurrent provisioning and rejects changed parameters", async () => {
  const t = setup();
  const ids = await Promise.all(
    Array.from({ length: 8 }, () => enqueue(t, "same")),
  );
  expect(new Set(ids).size).toBe(1);
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleOperations").collect()),
  ).toHaveLength(1);
  await expect(
    enqueue(t, "same", { ...profile, name: "Changed" }),
  ).rejects.toThrow(/different parameters/);
  await expect(
    t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "same",
      request: profile,
      callback: "different",
    }),
  ).rejects.toThrow(/different parameters/);
  provider.mockResolvedValue({ status: "succeeded", resourceId: "profile-1" });
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(provider).toHaveBeenCalledTimes(1);
  expect(await enqueue(t, "same")).toBe(ids[0]);
});

it("rejects credentials in strict requests and unsafe webhook URLs before persistence", async () => {
  const t = setup();
  for (const field of ["apiKey", "authorization", "credentials"]) {
    await expect(
      t.mutation(lifecycle.enqueue, {
        scope: "scope",
        key: field,
        request: { ...profile, [field]: "secret" },
      }),
    ).rejects.toThrow();
  }
  for (const webhookUrl of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com?token=secret",
    "https://example.com#secret",
  ]) {
    await expect(
      enqueue(t, webhookUrl, { ...profile, webhookUrl }),
    ).rejects.toThrow(/HTTPS webhook URL/);
  }
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleOperations").collect()),
  ).toEqual([]);
});

it("isolates operation reads, reconciliation, and ownership by scope", async () => {
  const t = setup();
  const id = await ownProfile(t);
  expect(await t.query(lifecycle.get, { scope: "other", id })).toBeNull();
  expect(await t.query(lifecycle.resources, { scope: "other" })).toEqual([]);
  expect(await t.mutation(lifecycle.reconcile, { scope: "other", id })).toBe(
    false,
  );
  for (const request of [
    number,
    { kind: "deleteProfile" as const, resourceId: "profile-1" },
  ]) {
    await expect(
      t.mutation(lifecycle.enqueue, {
        scope: "other",
        key: request.kind,
        request,
      }),
    ).rejects.toThrow(/not owned/);
  }
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleOperations").collect()),
  ).toHaveLength(1);
});

it("recovers pending work with submitted=true and the persisted provider reference", async () => {
  const t = setup();
  const id = await enqueue(t, "pending");
  provider
    .mockResolvedValueOnce({ status: "pending", reference: "order-1" })
    .mockResolvedValueOnce({ status: "succeeded", resourceId: "profile-1" });
  await t.action(internal.lifecycleWorker.execute, { id });
  expect(provider).toHaveBeenNthCalledWith(1, profile, undefined, false, id);
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "pending",
    submitted: true,
  });
  await t.action(internal.lifecycleWorker.execute, { id });
  expect(provider).toHaveBeenNthCalledWith(2, profile, "order-1", true, id);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(provider).toHaveBeenCalledTimes(2);
  expect(await t.query(lifecycle.resources, { scope: "scope" })).toHaveLength(
    1,
  );
});

it("marks provider exceptions uncertain without losing the submission fence", async () => {
  const t = setup();
  const id = await enqueue(t, "exception");
  provider.mockRejectedValueOnce(new Error("connection lost"));
  await t.action(internal.lifecycleWorker.execute, { id });
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "uncertain",
    submitted: true,
  });
  expect(await t.mutation(lifecycle.reconcile, { scope: "scope", id })).toBe(
    true,
  );
  provider.mockResolvedValueOnce({
    status: "succeeded",
    resourceId: "profile-1",
  });
  await t.action(internal.lifecycleWorker.execute, { id });
  expect(provider).toHaveBeenLastCalledWith(profile, undefined, true, id);
});

it("retries only confirmed no-effect attempts as fresh submissions", async () => {
  const t = setup();
  const id = await enqueue(t, "safe-retry");
  const claim = await t.mutation(worker.claim, { id });
  await t.mutation(worker.finish, {
    id,
    generation: claim!.generation,
    status: "pending",
    noEffect: true,
  });
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "pending",
    submitted: false,
  });
  provider.mockResolvedValueOnce({
    status: "succeeded",
    resourceId: "profile-1",
  });
  await t.action(internal.lifecycleWorker.execute, { id });
  expect(provider).toHaveBeenCalledWith(profile, undefined, false, id);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(provider).toHaveBeenCalledTimes(1);
});

it("retains locks for ambiguous failures and removes them for confirmed no-effect failures", async () => {
  const t = setup();
  await ownProfile(t);
  const args = { scope: "scope", key: "buy", request: number };
  const id = await t.mutation(lifecycle.enqueue, args);
  const first = await t.mutation(worker.claim, { id });
  await t.mutation(worker.finish, {
    id,
    generation: first!.generation,
    status: "failed",
  });
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleLocks").collect()),
  ).toHaveLength(2);
  await expect(
    t.mutation(lifecycle.enqueue, { ...args, key: "blocked" }),
  ).rejects.toThrow(/unresolved/);
  expect(await t.mutation(lifecycle.reconcile, { scope: "scope", id })).toBe(
    true,
  );
  const second = await t.mutation(worker.claim, { id });
  expect(second?.submitted).toBe(true);
  await t.mutation(worker.finish, {
    id,
    generation: second!.generation,
    status: "failed",
    noEffect: true,
  });
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleLocks").collect()),
  ).toEqual([]);
  expect(await t.mutation(lifecycle.reconcile, { scope: "scope", id })).toBe(
    false,
  );
  expect(await t.mutation(lifecycle.enqueue, args)).toBe(id);
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleLocks").collect()),
  ).toEqual([]);
  expect(
    await t.mutation(lifecycle.enqueue, { ...args, key: "retry" }),
  ).not.toBe(id);
});

it("expires abandoned claims and fences late completion and expiry from older generations", async () => {
  const t = setup();
  const id = await enqueue(t, "fencing");
  const first = await t.mutation(worker.claim, { id });
  expect(await t.mutation(worker.claim, { id })).toBeNull();
  await t.mutation(worker.expire, { id, generation: first!.generation });
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "uncertain",
  });
  await t.mutation(lifecycle.reconcile, { scope: "scope", id });
  const second = await t.mutation(worker.claim, { id });
  expect(second).toMatchObject({
    submitted: true,
    generation: first!.generation + 1,
  });
  await t.mutation(worker.expire, { id, generation: first!.generation });
  await t.mutation(worker.finish, {
    id,
    generation: first!.generation,
    status: "succeeded",
    resourceId: "stale",
  });
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "running",
    generation: second!.generation,
  });
  expect(await t.query(lifecycle.resources, { scope: "scope" })).toEqual([]);
  await t.mutation(worker.finish, {
    id,
    generation: second!.generation,
    status: "succeeded",
    resourceId: "current",
  });
  expect(await t.query(lifecycle.resources, { scope: "scope" })).toMatchObject([
    { externalId: "current" },
  ]);
});

it("keeps completion atomic when a provider ID belongs to another scope", async () => {
  const t = setup();
  await ownProfile(t);
  const id = await enqueue(t, "collision", profile, "other");
  const claim = await t.mutation(worker.claim, { id });
  await expect(
    t.mutation(worker.finish, {
      id,
      generation: claim!.generation,
      status: "succeeded",
      resourceId: "profile-1",
    }),
  ).rejects.toThrow(/another scope/);
  expect(await t.query(lifecycle.get, { scope: "other", id })).toMatchObject({
    status: "running",
    delivered: false,
  });
  expect(await t.query(lifecycle.resources, { scope: "other" })).toEqual([]);
  expect(await t.query(lifecycle.resources, { scope: "scope" })).toMatchObject([
    { externalId: "profile-1", deleted: false },
  ]);
});

it("does not reclassify failed completion persistence as a provider failure", async () => {
  const t = setup();
  await ownProfile(t);
  const id = await enqueue(t, "worker-collision", profile, "other");
  provider.mockResolvedValueOnce({
    status: "succeeded",
    resourceId: "profile-1",
  });
  await expect(
    t.action(internal.lifecycleWorker.execute, { id }),
  ).rejects.toThrow(/another scope/);
  expect(await t.query(lifecycle.get, { scope: "other", id })).toMatchObject({
    status: "running",
    submitted: true,
  });
  expect(await t.query(lifecycle.resources, { scope: "other" })).toEqual([]);
});

it("locks purchases, rejects a new key for an owned number, and releases dependencies before profile deletion", async () => {
  const t = setup();
  await ownProfile(t);
  const id = await t.mutation(lifecycle.enqueue, {
    scope: "scope",
    key: "buy",
    request: number,
  });
  await expect(
    t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "duplicate",
      request: number,
    }),
  ).rejects.toThrow(/unresolved/);
  await expect(
    t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "delete",
      request: { kind: "deleteProfile", resourceId: "profile-1" },
    }),
  ).rejects.toThrow(/unresolved/);
  await succeed(t, id, "number-1");
  await expect(
    t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "new-key",
      request: number,
    }),
  ).rejects.toThrow(/already owned/);
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleLocks").collect()),
  ).toEqual([]);
  await expect(
    t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "delete",
      request: { kind: "deleteProfile", resourceId: "profile-1" },
    }),
  ).rejects.toThrow(/Release all owned numbers/);
  const releaseArgs = {
    scope: "scope",
    key: "release",
    request: { kind: "releaseNumber" as const, resourceId: "number-1" },
  };
  const release = await t.mutation(lifecycle.enqueue, releaseArgs);
  await succeed(t, release);
  expect(await t.mutation(lifecycle.enqueue, releaseArgs)).toBe(release);
  expect(
    await t.mutation(lifecycle.enqueue, {
      scope: "scope",
      key: "buy",
      request: number,
    }),
  ).toBe(id);
  expect(await t.query(lifecycle.resources, { scope: "scope" })).toContainEqual(
    expect.objectContaining({
      externalId: "number-1",
      deleted: true,
      operationId: release,
    }),
  );
  expect(
    await t.run((ctx) => ctx.db.query("lifecycleLocks").collect()),
  ).toEqual([]);
  const deletion = await t.mutation(lifecycle.enqueue, {
    scope: "scope",
    key: "delete",
    request: { kind: "deleteProfile", resourceId: "profile-1" },
  });
  await succeed(t, deletion);
  expect(
    (await t.query(lifecycle.resources, { scope: "scope" })).every(
      (resource) => resource.deleted,
    ),
  ).toBe(true);
});

it("rolls back callback effects on failure and atomically redrives only once", async () => {
  const callback = internalMutationGeneric({
    args: { scope: v.string(), operationId: v.string(), snapshot: v.any() },
    handler: async (ctx, { operationId }) => {
      await ctx.db.insert("hits", { operationId });
      const toggle = await ctx.db.query("toggles").first();
      if (toggle?.fail) throw new Error("intentional callback failure");
      return null;
    },
  });
  const t = convexTest(
    defineSchema({
      ...schema.tables,
      toggles: defineTable({ fail: v.boolean() }),
      hits: defineTable({ operationId: v.string() }),
    }),
    { ...modules, "./component/callback.ts": async () => ({ callback }) },
  );
  const toggle = await t.run((ctx) => ctx.db.insert("toggles", { fail: true }));
  const handle = await t.run(() =>
    createFunctionHandle(
      makeFunctionReference<"mutation">("callback:callback"),
    ),
  );
  const id = await t.mutation(lifecycle.enqueue, {
    scope: "scope",
    key: "callback",
    request: profile,
    callback: handle,
  });
  const claim = await t.mutation(worker.claim, { id });
  await t.mutation(worker.finish, {
    id,
    generation: claim!.generation,
    status: "succeeded",
    resourceId: "profile-1",
  });
  await expect(t.mutation(worker.deliver, { id })).rejects.toThrow(
    /intentional callback failure/,
  );
  expect(await t.run((ctx) => ctx.db.query("hits").collect())).toEqual([]);
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    status: "succeeded",
    delivered: false,
  });
  expect(
    await t.mutation(lifecycle.redriveCallback, { scope: "other", id }),
  ).toBe(false);
  await t.run((ctx) => ctx.db.patch(toggle, { fail: false }));
  expect(
    await t.mutation(lifecycle.redriveCallback, { scope: "scope", id }),
  ).toBe(true);
  expect(
    await t.mutation(lifecycle.redriveCallback, { scope: "scope", id }),
  ).toBe(false);
  await t.mutation(worker.deliver, { id });
  expect(await t.run((ctx) => ctx.db.query("hits").collect())).toEqual([
    expect.objectContaining({ operationId: id }),
  ]);
  expect(await t.query(lifecycle.get, { scope: "scope", id })).toMatchObject({
    delivered: true,
  });
});
