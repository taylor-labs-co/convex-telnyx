import { it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { Telnyx, type LifecycleHandler } from "../src/client/index.js";
import registration from "../src/test.js";
import { components } from "../example/convex/_generated/api.js";
import schema from "../src/component/schema.js";
import { modules } from "../src/test.js";
import { api } from "../src/component/_generated/api.js";

it("unlocks the profile after a confirmed purchase rejection through the real worker", async () => {
  vi.useFakeTimers();
  vi.stubEnv("TELNYX_API_KEY", "test-key");
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (body.phone_numbers) return new Response("{}", { status: 422 });
    return new Response(JSON.stringify({ data: { id: "profile-1", ...body } }));
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const t = convexTest(schema, modules);
    await t.mutation(api.lifecycle.enqueue, {
      scope: "tenant",
      key: "profile",
      request: {
        kind: "profile",
        name: "Tenant",
        webhookUrl: "https://example.com/hook",
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const id = await t.mutation(api.lifecycle.enqueue, {
      scope: "tenant",
      key: "number",
      request: {
        kind: "number",
        phoneNumber: "+15555550100",
        messagingProfileId: "profile-1",
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.query(api.lifecycle.get, { scope: "tenant", id }),
    ).toMatchObject({ status: "failed", noEffect: true });
    expect(
      await t.mutation(api.lifecycle.reconcile, { scope: "tenant", id }),
    ).toBe(false);
    await expect(
      t.mutation(api.lifecycle.enqueue, {
        scope: "tenant",
        key: "cleanup",
        request: { kind: "deleteProfile", resourceId: "profile-1" },
      }),
    ).resolves.toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("binds through the client with portable validators and atomic cross-component callback redrive", async () => {
  vi.useFakeTimers();
  vi.stubEnv("TELNYX_API_KEY", "test-key");
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    return new Response(JSON.stringify({ data: { id: "profile-1", ...body } }));
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const t = convexTest(
      defineSchema({
        toggles: defineTable({ fail: v.boolean() }),
        hits: defineTable({ eventId: v.string() }),
      }),
      {
        "./_generated/api.ts": async () => ({}),
        "./handlers.ts": () => import("./fixtures/handlers.js"),
      },
    );
    registration.register(t);
    const client = new Telnyx(components.telnyx);
    const toggle = await t.run((ctx) =>
      ctx.db.insert("toggles", { fail: true }),
    );
    const id = await t.mutation((ctx) =>
      client.lifecycle.enqueue(
        ctx,
        {
          kind: "profile",
          name: "Tenant",
          webhookUrl: "https://example.com/hook",
        },
        {
          scope: "tenant",
          idempotencyKey: "create",
          callback: makeFunctionReference(
            "handlers:lifecycleFinished",
          ) as unknown as LifecycleHandler,
        },
      ),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.query((ctx) => client.lifecycle.get(ctx, "tenant", id)),
    ).toMatchObject({ status: "succeeded", delivered: false });
    expect(await t.run((ctx) => ctx.db.query("hits").collect())).toEqual([]);
    const page = await t.query((ctx) =>
      client.lifecycle.list(ctx, "tenant", { cursor: null, numItems: 10 }),
    );
    expect(page.page.map((op) => op._id)).toEqual([id]);
    expect(
      await t.query((ctx) => client.lifecycle.resources(ctx, "tenant")),
    ).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(toggle, { fail: false }));
    expect(
      await t.mutation((ctx) =>
        client.lifecycle.redriveCallback(ctx, "tenant", id),
      ),
    ).toBe(true);
    expect(
      await t.mutation((ctx) =>
        client.lifecycle.redriveCallback(ctx, "tenant", id),
      ),
    ).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("hits").collect())).toHaveLength(
      1,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
