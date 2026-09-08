import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import workpool from "@convex-dev/workpool/test";
import schema from "../src/component/schema.js";
import { api, internal } from "../src/component/_generated/api.js";
import { callCommands } from "../src/shared.js";
import { callPaths } from "../src/callPaths.js";
const modules = import.meta.glob("../src/component/**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  workpool.register(t, "workpool");
  workpool.register(t, "voicePool");
  return t;
}
const page = { cursor: null, numItems: 10 };
const message = {
  scope: "tenant-a",
  key: "first",
  method: "messages.send",
  request: { from: "+15555550100", to: "+15555550101", text: "hello" },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TELNYX_API_KEY", "test-key");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("durable operations", () => {
  it("deduplicates a send and rejects key reuse with a changed request", async () => {
    const t = setup();
    const id = await t.mutation(api.operations.enqueue, message);
    expect(await t.mutation(api.operations.enqueue, message)).toBe(id);
    await expect(
      t.mutation(api.operations.enqueue, {
        ...message,
        request: { ...message.request, text: "changed" },
      }),
    ).rejects.toThrow(/different/);
  });
  it("allows the same idempotency key in another tenant", async () => {
    const t = setup();
    const a = await t.mutation(api.operations.enqueue, message),
      b = await t.mutation(api.operations.enqueue, {
        ...message,
        scope: "tenant-b",
      });
    expect(a).not.toBe(b);
  });
  it("does not disclose operations across tenants", async () => {
    const t = setup();
    const id = await t.mutation(api.operations.enqueue, message);
    expect(
      await t.query(api.operations.get, { scope: "tenant-b", id }),
    ).toBeNull();
    expect(
      (
        await t.query(api.operations.list, {
          scope: "tenant-b",
          paginationOpts: page,
        })
      ).page,
    ).toEqual([]);
    expect(
      await t.mutation(api.operations.cancel, { scope: "tenant-b", id }),
    ).toBe(false);
  });
  it("cancels queued work and prevents claiming it", async () => {
    const t = setup();
    const id = await t.mutation(api.operations.enqueue, message);
    expect(
      await t.mutation(api.operations.cancel, { scope: message.scope, id }),
    ).toBe(true);
    expect(await t.mutation(internal.operations.claim, { id })).toBeNull();
    expect(
      (await t.query(api.operations.get, { scope: message.scope, id }))
        ?.request,
    ).toBeNull();
  });
  it("only permits one worker to claim an operation", async () => {
    const t = setup();
    const id = await t.mutation(api.operations.enqueue, message);
    expect(await t.mutation(internal.operations.claim, { id })).not.toBeNull();
    expect(await t.mutation(internal.operations.claim, { id })).toBeNull();
    expect(
      await t.mutation(api.operations.cancel, { scope: message.scope, id }),
    ).toBe(false);
  });
  it.each([
    { method: "arbitrary.admin", request: {} },
    {
      method: "messages.send",
      request: { to: "+15555550101", from: "+15555550100" },
    },
    { method: "calls.dial", request: { to: "+15555550101" } },
    { method: "calls.hangup", request: {} },
    {
      method: "verification.sms",
      request: {
        phone_number: "+15555550101",
        verify_profile_id: "p",
        custom_code: "1234",
      },
    },
  ])("rejects invalid request $method before scheduling", async (x) => {
    const t = setup();
    await expect(
      t.mutation(api.operations.enqueue, { scope: "a", key: "k", ...x }),
    ).rejects.toThrow();
  });
  it("supports cursor pagination without leaking tenants", async () => {
    const t = setup();
    for (let i = 0; i < 5; i++)
      await t.mutation(api.operations.enqueue, { ...message, key: `k${i}` });
    const first = await t.query(api.operations.list, {
      scope: message.scope,
      paginationOpts: { cursor: null, numItems: 2 },
    });
    const second = await t.query(api.operations.list, {
      scope: message.scope,
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(second.page).toHaveLength(2);
    expect(
      new Set([...first.page, ...second.page].map((x) => x._id)).size,
    ).toBe(4);
  });
});
async function queued(
  t: ReturnType<typeof setup>,
  method = message.method,
  request: any = message.request,
  target?: string,
) {
  return t.run((ctx) =>
    ctx.db.insert("operations", {
      scope: "tenant-a",
      key: "k",
      method,
      request,
      target,
      fingerprint: "test",
      status: "queued",
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
describe("provider boundary", () => {
  it("persists successful sends without retaining a second request copy", async () => {
    const t = setup();
    const id = await queued(t);
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { id: "m1", to: [{ status: "queued" }] } }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.worker.execute, { id });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      await t.query(api.operations.get, { scope: "tenant-a", id }),
    ).toMatchObject({ status: "succeeded", resourceId: "m1", request: null });
    expect(
      await t.query(api.resources.get, {
        scope: "tenant-a",
        kind: "message",
        externalId: "m1",
      }),
    ).toMatchObject({ status: "queued" });
  });
  it.each([400, 401, 403, 422])(
    "marks HTTP %s terminal without automatic retries",
    async (status) => {
      const t = setup();
      const id = await queued(t);
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("rejected", { status }));
      vi.stubGlobal("fetch", fetch);
      await t.action(internal.worker.execute, { id });
      expect(
        (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
      ).toBe("failed");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([408, 500, 503])(
    "preserves unknown outcomes for HTTP %s",
    async (status) => {
      const t = setup();
      const id = await queued(t);
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response("error", { status }));
      vi.stubGlobal("fetch", fetch);
      await t.action(internal.worker.execute, { id });
      expect(
        (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
      ).toBe("uncertain");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("does not retry network failures", async () => {
    const t = setup();
    const id = await queued(t);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await t.action(internal.worker.execute, { id });
    expect(
      (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
    ).toBe("uncertain");
  });
  it("requeues explicit 429 responses", async () => {
    const t = setup();
    const id = await queued(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      ),
    );
    await t.action(internal.worker.execute, { id });
    expect(
      await t.query(api.operations.get, { scope: "tenant-a", id }),
    ).toMatchObject({ status: "queued", attempts: 1 });
  });
  it("bounds rate-limit attempts", async () => {
    const t = setup();
    const id = await queued(t);
    await t.run((ctx) => ctx.db.patch(id, { attempts: 4 }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("limited", { status: 429 })),
    );
    await t.action(internal.worker.execute, { id });
    expect(
      await t.query(api.operations.get, { scope: "tenant-a", id }),
    ).toMatchObject({ status: "failed", attempts: 5 });
  });
  it("translates bridge SDK parameters and preserves command IDs", async () => {
    const t = setup();
    const id = await queued(
      t,
      "calls.bridge",
      { call_control_id_to_bridge_with: "other", command_id: "stable" },
      "v3:call/id",
    );
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"data":{"result":"ok"}}'));
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.worker.execute, { id });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.telnyx.com/v2/calls/v3%3Acall%2Fid/actions/bridge",
    );
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      call_control_id: "other",
      command_id: "stable",
    });
  });
  it("uses PUT for updating client state", async () => {
    const t = setup();
    const id = await queued(
      t,
      "calls.updateClientState",
      { client_state: "aGk=" },
      "call1",
    );
    const fetch = vi.fn().mockResolvedValue(new Response('{"data":{}}'));
    vi.stubGlobal("fetch", fetch);
    await t.action(internal.worker.execute, { id });
    expect(fetch.mock.calls[0]?.[1].method).toBe("PUT");
  });
  it("maps every supported call command", () => {
    expect([...Object.keys(callPaths)].sort()).toEqual(
      [...callCommands].sort(),
    );
  });
});
const event = (id: string, type: string, occurredAt: number, payload: any) => ({
  scope: "tenant-a",
  event: { id, type, occurredAt, payload },
});
describe("webhook state", () => {
  it("deduplicates event IDs", async () => {
    const t = setup();
    const args = event("e1", "message.received", 1000, {
      id: "m",
      text: "hello",
    });
    expect((await t.mutation(api.events.ingest, args)).duplicate).toBe(false);
    expect((await t.mutation(api.events.ingest, args)).duplicate).toBe(true);
    expect(
      (
        await t.query(api.events.list, {
          scope: "tenant-a",
          paginationOpts: page,
        })
      ).page,
    ).toHaveLength(1);
  });
  it("does not regress delivered messages on late events or API responses", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e1", "message.finalized", 3000, {
        id: "m",
        to: [{ status: "delivered" }],
        cost: { amount: "0.01" },
      }),
    );
    await t.mutation(
      api.events.ingest,
      event("e2", "message.sent", 2000, { id: "m", to: [{ status: "sent" }] }),
    );
    await t.mutation(api.resources.sync, {
      scope: "tenant-a",
      kind: "message",
      externalId: "m",
      status: "queued",
      at: 1000,
      data: { id: "m" },
    });
    expect(
      await t.query(api.resources.get, {
        scope: "tenant-a",
        kind: "message",
        externalId: "m",
      }),
    ).toMatchObject({
      status: "delivered",
      data: { cost: { amount: "0.01" } },
    });
  });
  it("keeps hangup terminal while preserving later recording events", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e1", "call.hangup", 3000, {
        call_control_id: "c",
        hangup_cause: "normal_clearing",
      }),
    );
    await t.mutation(
      api.events.ingest,
      event("e2", "call.answered", 4000, { call_control_id: "c" }),
    );
    await t.mutation(
      api.events.ingest,
      event("e3", "call.recording.saved", 5000, {
        call_control_id: "c",
        recording_urls: { mp3: "https://example.com/r" },
      }),
    );
    expect(
      await t.query(api.resources.get, {
        scope: "tenant-a",
        kind: "call",
        externalId: "c",
      }),
    ).toMatchObject({
      status: "hangup",
      data: { recording_urls: { mp3: "https://example.com/r" } },
    });
  });
  it("retains unknown Telnyx events for future features", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e1", "fax.received", 1000, { fax_id: "f" }),
    );
    expect(
      (
        await t.query(api.events.list, {
          scope: "tenant-a",
          paginationOpts: page,
        })
      ).page[0]?.type,
    ).toBe("fax.received");
  });
  it("scopes resources and event histories", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e1", "call.initiated", 1000, { call_control_id: "c" }),
    );
    expect(
      await t.query(api.resources.get, {
        scope: "other",
        kind: "call",
        externalId: "c",
      }),
    ).toBeNull();
    expect(
      (await t.query(api.events.list, { scope: "other", paginationOpts: page }))
        .page,
    ).toEqual([]);
  });
});
describe("cross-feature protections", () => {
  it("blocks call commands against resources belonging to another scope", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e", "call.initiated", 1000, { call_control_id: "call" }),
    );
    await expect(
      t.mutation(api.operations.enqueue, {
        scope: "other",
        key: "hangup",
        method: "calls.hangup",
        target: "call",
        request: {},
      }),
    ).rejects.toThrow(/scope/);
  });
  it("reports partial delivery for group messages", async () => {
    const t = setup();
    await t.mutation(
      api.events.ingest,
      event("e", "message.finalized", 1000, {
        id: "group",
        to: [{ status: "delivered" }, { status: "delivery_failed" }],
      }),
    );
    expect(
      await t.query(api.resources.get, {
        scope: "tenant-a",
        kind: "message",
        externalId: "group",
      }),
    ).toMatchObject({ status: "partially_delivered" });
  });
  it("bounds query page size", async () => {
    const t = setup();
    await expect(
      t.query(api.operations.list, {
        scope: "a",
        paginationOpts: { cursor: null, numItems: 10000 },
      }),
    ).rejects.toThrow(/Page size/);
  });
  it("redacts payloads but preserves idempotency keys", async () => {
    const t = setup();
    const id = await t.mutation(api.operations.enqueue, message);
    await t.mutation(api.operations.cancel, { scope: "tenant-a", id });
    expect(
      await t.mutation(api.maintenance.redact, {
        scope: "tenant-a",
        operationIds: [id],
      }),
    ).toBe(1);
    expect(await t.mutation(api.operations.enqueue, message)).toBe(id);
  });
});
describe("recovery edge cases", () => {
  it("deduplicates scheduled requests even after their original runAt passes", async () => {
    const t = setup();
    const args = { ...message, runAt: Date.now() + 10_000 };
    const id = await t.mutation(api.operations.enqueue, args);
    vi.setSystemTime(Date.now() + 20_000);
    expect(await t.mutation(api.operations.enqueue, args)).toBe(id);
  });
  it("treats success responses missing a provider ID as uncertain", async () => {
    const t = setup();
    const id = await queued(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response('{"data":{}}')),
    );
    await t.action(internal.worker.execute, { id });
    expect(
      (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
    ).toBe("uncertain");
  });
  it("does not retry early when Retry-After exceeds one day", async () => {
    const t = setup();
    const id = await queued(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("limited", {
          status: 429,
          headers: { "retry-after": "100000" },
        }),
      ),
    );
    await t.action(internal.worker.execute, { id });
    expect(
      (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
    ).toBe("failed");
  });
  it("marks worker crashes uncertain and ignores old completion callbacks", async () => {
    const t = setup();
    const id = await queued(t);
    await t.run((ctx) =>
      ctx.db.patch(id, { status: "running", workId: "current" }),
    );
    await t.mutation(internal.operations.onComplete, {
      workId: "old" as any,
      context: { id },
      result: { kind: "failed", error: "crash" },
    });
    expect(
      (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
    ).toBe("running");
    await t.mutation(internal.operations.onComplete, {
      workId: "current" as any,
      context: { id },
      result: { kind: "failed", error: "crash" },
    });
    expect(
      (await t.query(api.operations.get, { scope: "tenant-a", id }))?.status,
    ).toBe("uncertain");
  });
});
