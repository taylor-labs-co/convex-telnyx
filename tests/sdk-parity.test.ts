import { afterEach, beforeEach, it, expect, vi } from "vitest";
import TelnyxSDK from "telnyx";
import { convexTest } from "convex-test";
import workpool from "@convex-dev/workpool/test";
import schema from "../src/component/schema.js";
import { internal } from "../src/component/_generated/api.js";
import { callCommands } from "../src/shared.js";
const modules = import.meta.glob("../src/component/**/*.ts");
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
it.each(callCommands)(
  "matches official SDK URL, verb and body for %s",
  async (command) => {
    const request = {
      command_id: "command",
      call_control_id_to_bridge_with: "other",
      client_state: "aGk=",
    };
    const sdkFetch = vi.fn().mockImplementation(
      async () =>
        new Response('{"data":{"result":"ok"}}', {
          headers: { "content-type": "application/json" },
        }),
    );
    const sdk = new TelnyxSDK({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: sdkFetch,
    });
    const method = sdk.calls.actions[command] as (
      id: string,
      body: any,
    ) => Promise<unknown>;
    await method.call(sdk.calls.actions, "call/one", request);
    const t = convexTest(schema, modules);
    workpool.register(t, "workpool");
    workpool.register(t, "voicePool");
    const id = await t.run((ctx) =>
      ctx.db.insert("operations", {
        scope: "a",
        key: "k",
        fingerprint: "f",
        method: `calls.${command}`,
        target: "call/one",
        request,
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const componentFetch = vi
      .fn()
      .mockImplementation(async () => new Response('{"data":{"result":"ok"}}'));
    vi.stubGlobal("fetch", componentFetch);
    await t.action(internal.worker.execute, { id });
    const expected = sdkFetch.mock.calls[0],
      actual = componentFetch.mock.calls[0];
    expect(actual?.[0]).toBe(String(expected?.[0]));
    expect(actual?.[1].method).toBe(expected?.[1].method);
    expect(JSON.parse(actual?.[1].body)).toEqual(
      JSON.parse(expected?.[1].body),
    );
  },
);
