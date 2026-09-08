import { it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  createFunctionHandle,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import telnyxTest from "../src/test.js";
import { components } from "../example/convex/_generated/api.js";
it("rolls back failed hooks, exhausts retries and redrives without duplicate effects", async () => {
  vi.useFakeTimers();
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
    telnyxTest.register(t);
    const toggle = await t.run((ctx) =>
      ctx.db.insert("toggles", { fail: true }),
    );
    const handler = await t.run(() =>
      createFunctionHandle(
        makeFunctionReference<"mutation">("handlers:processEvent"),
      ),
    );
    const { id } = await t.mutation(components.telnyx.events.ingest, {
      scope: "scope",
      event: {
        id: "event",
        type: "fax.received",
        occurredAt: 1000,
        payload: {},
      },
      handler,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toEqual([]);
    const events = await t.query(components.telnyx.events.list, {
      scope: "scope",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(events.page[0]?.status).toBe("failed");
    expect(
      await t.mutation(components.telnyx.events.redrive, {
        scope: "wrong",
        id,
      }),
    ).toBe(false);
    await t.run((ctx) => ctx.db.patch(toggle, { fail: false }));
    expect(
      await t.mutation(components.telnyx.events.redrive, {
        scope: "scope",
        id,
      }),
    ).toBe(true);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toHaveLength(1);
    expect(
      await t.mutation(components.telnyx.events.redrive, {
        scope: "scope",
        id,
      }),
    ).toBe(false);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
