import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  defineSchema,
  defineTable,
  makeFunctionReference,
  httpRouter,
} from "convex/server";
import { v } from "convex/values";
import {
  Telnyx,
  MessageSendError,
  type MessageSentHandler,
} from "../src/client/index.js";
import registration from "../src/test.js";
import { components } from "../example/convex/_generated/api.js";
import schema from "../src/component/schema.js";
import { api, internal } from "../src/component/_generated/api.js";
import workpool from "@convex-dev/workpool/test";
const scope = "tenant",
  page = { cursor: null, numItems: 10 };
const callback = makeFunctionReference(
  "handlers:messageSent",
) as unknown as MessageSentHandler;
function setup() {
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
  return t;
}
function client(options: ConstructorParameters<typeof Telnyx>[1] = {}) {
  return new Telnyx(components.telnyx, {
    defaultFrom: "+15555550100",
    ...options,
  });
}
function provider(
  data: any = {
    id: "message",
    from: { phone_number: "+15555550100" },
    to: [{ phone_number: "+15555550101", status: "queued" }],
  },
) {
  const fetch = vi
    .fn()
    .mockImplementation(async () => new Response(JSON.stringify({ data })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TELNYX_API_KEY", "test-key");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("send conveniences", () => {
  it("adds the default sender and automatic status webhook", async () => {
    const t = setup(),
      c = client();
    const id = await t.mutation((ctx) =>
      c.sendMessage(
        ctx,
        { to: "+15555550101", text: "hello" },
        { scope, idempotencyKey: "k" },
      ),
    );
    const op = await t.query((ctx) => c.getOperation(ctx, scope, id));
    expect(op?.request).toMatchObject({
      from: "+15555550100",
      webhook_url: "https://example.convex.site/telnyx/webhook",
    });
  });
  it("honors explicit sender and webhook overrides", async () => {
    const t = setup(),
      c = client();
    const id = await t.mutation((ctx) =>
      c.sendMessage(
        ctx,
        {
          to: "+15555550101",
          from: "+15555550102",
          text: "hello",
          webhook_url: "https://other.example/hook",
        },
        { scope, idempotencyKey: "k" },
      ),
    );
    expect(
      (await t.query((ctx) => c.getOperation(ctx, scope, id)))?.request,
    ).toMatchObject({
      from: "+15555550102",
      webhook_url: "https://other.example/hook",
    });
  });
  it("does not override explicit number-pool selection with the default sender", async () => {
    const t = setup(),
      c = client();
    const id = await t.mutation((ctx) =>
      c.sendMessage(
        ctx,
        { to: "+15555550101", messaging_profile_id: "pool", text: "hello" },
        { scope, idempotencyKey: "k" },
      ),
    );
    expect(
      (await t.query((ctx) => c.getOperation(ctx, scope, id)))?.request.from,
    ).toBeUndefined();
  });
  it("honors explicit profile webhook routing", async () => {
    const t = setup(),
      c = client();
    vi.stubEnv("CONVEX_SITE_URL", "");
    const id = await t.mutation((ctx) =>
      c.sendMessage(
        ctx,
        { to: "+15555550101", text: "hello", use_profile_webhooks: true },
        { scope, idempotencyKey: "k" },
      ),
    );
    expect(
      (await t.query((ctx) => c.getOperation(ctx, scope, id)))?.request
        .webhook_url,
    ).toBeUndefined();
  });
  it("uses the same custom path for sends and route registration", () => {
    const c = client({ webhookPath: "/custom/telnyx" });
    expect(c.getWebhookUrl()).toBe("https://example.convex.site/custom/telnyx");
    expect(() =>
      c.registerRoutes(httpRouter(), {
        scope,
        publicKey: "test",
        path: "/custom/telnyx",
      }),
    ).not.toThrow();
    expect(() =>
      c.registerRoutes(httpRouter(), {
        scope,
        publicKey: "test",
        path: "/wrong",
      }),
    ).toThrow(/webhookPath/);
  });
  it("returns the provider message immediately and reuses confirmed idempotent results", async () => {
    const t = setup(),
      c = client(),
      fetch = provider();
    const send = () =>
      t.action((ctx) =>
        c.sendMessageNow(
          ctx,
          { to: "+15555550101", text: "hi" },
          { scope, idempotencyKey: "now" },
        ),
      );
    expect((await send()).id).toBe("message");
    expect((await send()).id).toBe("message");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await t.query((ctx) => c.listOutgoing(ctx, scope, page))).page,
    ).toHaveLength(1);
  });
  it.each([429, 500])(
    "does not background-retry an immediate HTTP %s response",
    async (status) => {
      const t = setup(),
        c = client();
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("error", { status }));
      vi.stubGlobal("fetch", fetch);
      await expect(
        t.action((ctx) =>
          c.sendMessageNow(
            ctx,
            { to: "+15555550101", text: "hi" },
            { scope, idempotencyKey: "now" },
          ),
        ),
      ).rejects.toBeInstanceOf(MessageSendError);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (await t.query((ctx) => c.listOperations(ctx, scope, page))).page[0]
          ?.status,
      ).toBe(status === 429 ? "failed" : "uncertain");
    },
  );
  it("runs default submission callbacks without a webhook", async () => {
    const t = setup(),
      c = client({ defaultOutgoingMessageCallback: callback }),
      fetch = provider();
    await t.action((ctx) =>
      c.sendMessageNow(
        ctx,
        { to: "+15555550101", text: "hi" },
        { scope, idempotencyKey: "now" },
      ),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (await t.query((ctx) => c.listOperations(ctx, scope, page))).page[0]
        ?.callbackStatus,
    ).toBe("delivered");
  });
  it("supports per-send callbacks for queued submissions", async () => {
    const t = setup(),
      c = client(),
      fetch = provider();
    const id = await t.mutation((ctx) =>
      c.sendMessage(
        ctx,
        { to: "+15555550101", text: "hi" },
        { scope, idempotencyKey: "queued", callback },
      ),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toHaveLength(1);
    expect(
      (await t.query((ctx) => c.getOperation(ctx, scope, id)))?.callbackStatus,
    ).toBe("delivered");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("allows disabling the default callback per send", async () => {
    const t = setup(),
      c = client({ defaultOutgoingMessageCallback: callback });
    provider();
    await t.action((ctx) =>
      c.sendMessageNow(
        ctx,
        { to: "+15555550101", text: "hi" },
        { scope, idempotencyKey: "now", callback: null },
      ),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toEqual([]);
  });
  it("redrives a failed submission callback without resending or losing its retained result", async () => {
    const t = setup(),
      c = client(),
      fetch = provider();
    const toggle = await t.run((ctx) =>
      ctx.db.insert("toggles", { fail: true }),
    );
    await t.action((ctx) =>
      c.sendMessageNow(
        ctx,
        { to: "+15555550101", text: "hi" },
        { scope, idempotencyKey: "now", callback },
      ),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const op = (await t.query((ctx) => c.listOperations(ctx, scope, page)))
      .page[0]!;
    expect(op.status).toBe("succeeded");
    expect(op.callbackStatus).toBe("failed");
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toEqual([]);
    expect(
      await t.mutation(components.telnyx.maintenance.redact, {
        scope,
        operationIds: [op._id],
      }),
    ).toBe(0);
    await t.run((ctx) => ctx.db.patch(toggle, { fail: false }));
    expect(
      await t.mutation((ctx) => c.redriveSendCallback(ctx, "wrong", op._id)),
    ).toBe(false);
    expect(
      await t.mutation((ctx) => c.redriveSendCallback(ctx, scope, op._id)),
    ).toBe(true);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.query("hits").take(10))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("indexed conversations", () => {
  async function seed(
    t: ReturnType<typeof setup>,
    id: string,
    direction: "inbound" | "outbound",
    from: string,
    to: string[],
    tenant = scope,
  ) {
    await t.mutation(components.telnyx.resources.sync, {
      scope: tenant,
      kind: "message",
      externalId: id,
      at: Date.now(),
      data: {
        direction,
        from: { phone_number: from },
        to: to.map((phone_number) => ({ phone_number })),
        text: id,
      },
    });
  }
  it("queries incoming, outgoing, from, to and two-way counterparties", async () => {
    const t = setup(),
      c = client();
    await seed(t, "in", "inbound", "customer", ["business"]);
    await seed(t, "out", "outbound", "business", ["customer"]);
    await seed(t, "other", "outbound", "business", ["else"]);
    expect(
      (await t.query((ctx) => c.listIncoming(ctx, scope, page))).page.map(
        (d) => d.externalId,
      ),
    ).toEqual(["in"]);
    expect(
      (await t.query((ctx) => c.listOutgoing(ctx, scope, page))).page,
    ).toHaveLength(2);
    expect(
      (await t.query((ctx) => c.getMessagesFrom(ctx, scope, "customer", page)))
        .page,
    ).toHaveLength(1);
    expect(
      (await t.query((ctx) => c.getMessagesTo(ctx, scope, "customer", page)))
        .page,
    ).toHaveLength(1);
    expect(
      (
        await t.query((ctx) =>
          c.getMessagesByCounterparty(ctx, scope, "customer", page),
        )
      ).page
        .map((d) => d.externalId)
        .sort(),
    ).toEqual(["in", "out"]);
    expect(
      (
        await t.query((ctx) =>
          c.getMessagesByCounterparty(ctx, "wrong", "customer", page),
        )
      ).page,
    ).toEqual([]);
  });
  it("indexes every group recipient once", async () => {
    const t = setup(),
      c = client();
    await seed(t, "group", "outbound", "business", ["a", "b", "a"]);
    for (const address of ["a", "b"]) {
      expect(
        (
          await t.query((ctx) =>
            c.getMessagesByCounterparty(ctx, scope, address, page),
          )
        ).page,
      ).toHaveLength(1);
    }
  });
  it("preserves conversation addresses when a partial status webhook arrives", async () => {
    const t = setup(),
      c = client();
    await seed(t, "message", "outbound", "business", ["customer"]);
    await t.mutation(components.telnyx.events.ingest, {
      scope,
      event: {
        id: "partial",
        type: "message.finalized",
        occurredAt: Date.now() + 1000,
        payload: { id: "message", to: [{ status: "delivered" }] },
      },
    });
    expect(
      (
        await t.query((ctx) =>
          c.getMessagesByCounterparty(ctx, scope, "customer", page),
        )
      ).page[0]?.status,
    ).toBe("delivered");
  });
  it("paginates conversations without repeating messages", async () => {
    const t = setup(),
      c = client();
    for (let i = 0; i < 4; i++)
      await seed(t, `m${i}`, "outbound", "business", ["customer"]);
    const first = await t.query((ctx) =>
      c.getMessagesByCounterparty(ctx, scope, "customer", {
        cursor: null,
        numItems: 2,
      }),
    );
    const second = await t.query((ctx) =>
      c.getMessagesByCounterparty(ctx, scope, "customer", {
        cursor: first.continueCursor,
        numItems: 2,
      }),
    );
    expect(
      new Set([...first.page, ...second.page].map((d) => d.externalId)).size,
    ).toBe(4);
  });
  it("removes indexed addresses when redacting a resource", async () => {
    const t = setup(),
      c = client();
    await seed(t, "message", "outbound", "business", ["customer"]);
    const d = await t.query((ctx) => c.getMessage(ctx, scope, "message"));
    await t.mutation(components.telnyx.maintenance.redact, {
      scope,
      resourceIds: [d!._id],
    });
    expect(
      (
        await t.query((ctx) =>
          c.getMessagesByCounterparty(ctx, scope, "customer", page),
        )
      ).page,
    ).toEqual([]);
  });
  it("backfills existing resource records idempotently", async () => {
    const t = convexTest(schema, import.meta.glob("../src/component/**/*.ts"));
    workpool.register(t, "workpool");
    workpool.register(t, "voicePool");
    await t.run((ctx) =>
      ctx.db.insert("resources", {
        scope,
        kind: "message",
        externalId: "old",
        status: "received",
        statusAt: 1000,
        updatedAt: 1000,
        data: {
          from: { phone_number: "customer" },
          to: [{ phone_number: "business" }],
        },
      }),
    );
    await t.mutation(api.messages.backfillIndexes, {
      scope,
      paginationOpts: page,
    });
    await t.mutation(api.messages.backfillIndexes, {
      scope,
      paginationOpts: page,
    });
    expect(
      (
        await t.query(api.messages.listByAddress, {
          scope,
          role: "counterparty",
          address: "customer",
          paginationOpts: page,
        })
      ).page,
    ).toHaveLength(1);
  });
});
describe("provider webhook setup", () => {
  it("updates a profile and attaches an existing number via the documented PATCH endpoints", async () => {
    const t = setup(),
      c = client(),
      fetch = provider({ phone_number: "+15555550100" });
    expect(
      await t.action((ctx) =>
        c.registerIncomingSmsHandler(ctx, {
          scope,
          phoneNumberId: "number/id",
          messagingProfileId: "profile",
        }),
      ),
    ).toMatchObject({
      phoneNumberId: "number/id",
      messagingProfileId: "profile",
    });
    expect(fetch.mock.calls.map((x) => x[0])).toEqual([
      "https://api.telnyx.com/v2/messaging_profiles/profile",
      "https://api.telnyx.com/v2/phone_numbers/number%2Fid/messaging",
    ]);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({
      webhook_api_version: "2",
      webhook_url: "https://example.convex.site/telnyx/webhook",
    });
    expect(fetch.mock.calls[0]![1].method).toBe("PATCH");
    expect(
      await t.query((ctx) => c.getPhoneNumber(ctx, scope, "number/id")),
    ).toMatchObject({ messagingProfileId: "profile" });
    expect(
      await t.query((ctx) => c.getPhoneNumber(ctx, "wrong", "number/id")),
    ).toBeNull();
  });
  it("discovers the number's current messaging profile when one is not supplied", async () => {
    const t = setup(),
      c = client(),
      fetch = provider({ messaging_profile_id: "existing" });
    await t.action((ctx) =>
      c.registerIncomingSmsHandler(ctx, { scope, phoneNumberId: "number" }),
    );
    expect(fetch.mock.calls[0]![1].method).toBe("GET");
    expect(fetch.mock.calls[1]![0]).toContain("/messaging_profiles/existing");
  });
  it("does not record a number as configured when attachment fails", async () => {
    const t = setup(),
      c = client();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"data":{}}'))
      .mockResolvedValueOnce(new Response("failed", { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      t.action((ctx) =>
        c.registerIncomingSmsHandler(ctx, {
          scope,
          phoneNumberId: "number",
          messagingProfileId: "profile",
        }),
      ),
    ).rejects.toThrow();
    expect(
      await t.query((ctx) => c.getMessagingProfile(ctx, scope, "profile")),
    ).not.toBeNull();
    expect(
      await t.query((ctx) => c.getPhoneNumber(ctx, scope, "number")),
    ).toBeNull();
  });
  it("does not record a failed profile update", async () => {
    const t = setup(),
      c = client();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("failed", { status: 401 })),
    );
    await expect(
      t.action((ctx) =>
        c.configureMessagingProfile(ctx, {
          scope,
          messagingProfileId: "profile",
        }),
      ),
    ).rejects.toThrow();
    expect(
      await t.query((ctx) => c.getMessagingProfile(ctx, scope, "profile")),
    ).toBeNull();
  });
  it("requires a public HTTPS webhook URL", () => {
    expect(() =>
      client({ webhookUrl: "http://localhost:3211/telnyx" }).getWebhookUrl(),
    ).toThrow(/HTTPS/);
  });
});
it("expires abandoned immediate reservations without calling Telnyx", async () => {
  const t = convexTest(schema, import.meta.glob("../src/component/**/*.ts"));
  workpool.register(t, "workpool");
  workpool.register(t, "voicePool");
  const fetch = provider();
  const args = {
    scope,
    key: "instant",
    method: "messages.send",
    request: { from: "business", to: "customer", text: "hi" },
    immediate: true,
  };
  const id = await t.mutation(api.operations.enqueue, args);
  await t.mutation(internal.operations.expireImmediate, { id });
  expect((await t.query(api.operations.get, { scope, id }))?.status).toBe(
    "failed",
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("concurrent immediate callers cannot submit the same message twice", async () => {
  const t = setup(),
    c = client();
  let release!: (response: Response) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetch = vi.fn().mockImplementation(() => {
    started();
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  });
  vi.stubGlobal("fetch", fetch);
  const send = () =>
    t.action((ctx) =>
      c.sendMessageNow(
        ctx,
        { to: "+15555550101", text: "hi" },
        { scope, idempotencyKey: "concurrent" },
      ),
    );
  const first = send();
  await entered;
  await expect(send()).rejects.toBeInstanceOf(MessageSendError);
  release(new Response('{"data":{"id":"message"}}'));
  expect((await first).id).toBe("message");
  expect(fetch).toHaveBeenCalledTimes(1);
});
