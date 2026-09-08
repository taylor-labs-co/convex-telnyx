import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import { ed25519 } from "@noble/curves/ed25519.js";
import schema from "../example/convex/schema.js";
import telnyxTest from "../src/test.js";
import { components } from "../example/convex/_generated/api.js";
const appModules = import.meta.glob("../example/convex/**/*.ts");
const secret = new Uint8Array(32).fill(11);
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv(
    "TELNYX_PUBLIC_KEY",
    Buffer.from(ed25519.getPublicKey(secret)).toString("base64"),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("processes a signed HTTP webhook through the app route, component and durable callback", async () => {
  const t = convexTest(schema, appModules);
  telnyxTest.register(t);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    data: {
      id: "http-event",
      event_type: "call.initiated",
      occurred_at: new Date().toISOString(),
      payload: { call_control_id: "http-call", direction: "incoming" },
    },
  });
  const headers = {
    "telnyx-timestamp": timestamp,
    "telnyx-signature-ed25519": Buffer.from(
      ed25519.sign(new TextEncoder().encode(`${timestamp}|${body}`), secret),
    ).toString("base64"),
  };
  expect(
    (await t.fetch("/telnyx/webhook", { method: "POST", body, headers }))
      .status,
  ).toBe(204);
  expect(
    (await t.fetch("/telnyx/webhook", { method: "POST", body, headers }))
      .status,
  ).toBe(204);
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  expect(
    await t.query(components.telnyx.resources.get, {
      scope: "demo-workspace",
      kind: "call",
      externalId: "http-call",
    }),
  ).toMatchObject({ status: "initiated" });
  const notifications = await t.run((ctx) =>
    ctx.db.query("notifications").take(10),
  );
  expect(notifications).toHaveLength(1);
  const events = await t.query(components.telnyx.events.list, {
    scope: "demo-workspace",
    paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(events.page[0]?.status).toBe("delivered");
});
it("rejects unverified HTTP requests before creating state", async () => {
  const t = convexTest(schema, appModules);
  telnyxTest.register(t);
  expect(
    (await t.fetch("/telnyx/webhook", { method: "POST", body: '{"data":{}}' }))
      .status,
  ).toBe(401);
  expect(
    (
      await t.query(components.telnyx.events.list, {
        scope: "demo-workspace",
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).page,
  ).toEqual([]);
});
