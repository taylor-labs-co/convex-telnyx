import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { verifyWebhook, readBody } from "../src/client/webhooks.js";
const secret = new Uint8Array(32).fill(7),
  publicKey = Buffer.from(ed25519.getPublicKey(secret)).toString("base64");
const now = 1_800_000_000_000;
const event = {
  data: {
    id: "event-1",
    event_type: "message.received",
    occurred_at: new Date(now).toISOString(),
    payload: { id: "message-1", text: "hello" },
  },
};
function signed(body = JSON.stringify(event), seconds = now / 1000) {
  const signature = ed25519.sign(
    new TextEncoder().encode(`${seconds}|${body}`),
    secret,
  );
  return {
    body,
    headers: new Headers({
      "telnyx-timestamp": String(seconds),
      "telnyx-signature-ed25519": Buffer.from(signature).toString("base64"),
    }),
  };
}
describe("webhook verification", () => {
  it("verifies real Ed25519 signatures over original bytes", () => {
    const x = signed();
    expect(verifyWebhook(x.body, x.headers, publicKey, { now })).toMatchObject({
      id: "event-1",
      type: "message.received",
    });
  });
  it("supports rotating public keys", () => {
    const x = signed();
    expect(
      verifyWebhook(x.body, x.headers, ["invalid", publicKey], { now }).id,
    ).toBe("event-1");
  });
  it("rejects tampered payloads", () => {
    const x = signed();
    expect(() =>
      verifyWebhook(x.body.replace("hello", "bye"), x.headers, publicKey, {
        now,
      }),
    ).toThrow();
  });
  it.each([-301, 301])(
    "rejects replay/future timestamp offset %s",
    (offset) => {
      const x = signed(undefined, now / 1000 + offset);
      expect(() =>
        verifyWebhook(x.body, x.headers, publicKey, { now }),
      ).toThrow(/timestamp/);
    },
  );
  it("rejects malformed signature encoding", () => {
    const x = signed();
    x.headers.set("telnyx-signature-ed25519", "!");
    expect(() =>
      verifyWebhook(x.body, x.headers, publicKey, { now }),
    ).toThrow();
  });
  it("rejects unsigned payloads", () =>
    expect(() =>
      verifyWebhook("{}", new Headers(), publicKey, { now }),
    ).toThrow());
  it("rejects a signed malformed event", () => {
    const x = signed('{"data":{}}');
    expect(() => verifyWebhook(x.body, x.headers, publicKey, { now })).toThrow(
      /envelope/,
    );
  });
  it("rejects a signed invalid JSON body", () => {
    const x = signed("invalid");
    expect(() => verifyWebhook(x.body, x.headers, publicKey, { now })).toThrow(
      /JSON/,
    );
  });
  it("rejects oversized streaming bodies without trusting Content-Length", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      body: "abcdefgh",
    });
    await expect(readBody(request, 4)).rejects.toThrow(/exceeds/);
  });
  it("reads multibyte payloads", async () =>
    expect(
      await readBody(
        new Request("https://example.com", {
          method: "POST",
          body: "hello 🌍",
        }),
      ),
    ).toBe("hello 🌍"));
});
