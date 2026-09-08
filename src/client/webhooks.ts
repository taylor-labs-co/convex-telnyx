import { ed25519 } from "@noble/curves/ed25519.js";
import type { WebhookEvent } from "../shared.js";
export class WebhookVerificationError extends Error {}
function decode(value: string, length: number): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    throw new WebhookVerificationError("Invalid base64");
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== length)
    throw new WebhookVerificationError("Invalid key or signature length");
  return bytes;
}
/** Verify the original bytes, never a parsed-and-reserialized JSON body. */
export function verifyWebhook(
  body: string,
  headers: Headers,
  publicKeys: string | readonly string[],
  options: { now?: number; toleranceSeconds?: number } = {},
): WebhookEvent {
  const signature = headers.get("telnyx-signature-ed25519"),
    timestamp = headers.get("telnyx-timestamp");
  const tolerance = options.toleranceSeconds ?? 300;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 300)
    throw new WebhookVerificationError("Invalid timestamp tolerance");
  if (!signature || !timestamp || !/^\d+$/.test(timestamp))
    throw new WebhookVerificationError("Missing signature or timestamp");
  if (
    Math.abs((options.now ?? Date.now()) / 1000 - Number(timestamp)) > tolerance
  )
    throw new WebhookVerificationError(
      "Webhook timestamp outside allowed window",
    );
  try {
    const sig = decode(signature, 64),
      message = new TextEncoder().encode(`${timestamp}|${body}`);
    const keys = typeof publicKeys === "string" ? [publicKeys] : publicKeys;
    if (
      !keys.some((key) => {
        try {
          return ed25519.verify(sig, message, decode(key, 32), {
            zip215: false,
          });
        } catch {
          return false;
        }
      })
    )
      throw new WebhookVerificationError("Invalid signature");
  } catch (error) {
    if (error instanceof WebhookVerificationError) throw error;
    throw new WebhookVerificationError("Invalid signature encoding");
  }
  let data: any;
  try {
    data = JSON.parse(body)?.data;
  } catch {
    throw new WebhookVerificationError("Invalid JSON");
  }
  if (
    !data ||
    typeof data.id !== "string" ||
    !data.id ||
    typeof data.event_type !== "string" ||
    !data.event_type ||
    typeof data.occurred_at !== "string" ||
    !Number.isFinite(Date.parse(data.occurred_at)) ||
    !data.payload ||
    typeof data.payload !== "object" ||
    Array.isArray(data.payload)
  )
    throw new WebhookVerificationError("Invalid event envelope");
  return {
    id: data.id,
    type: data.event_type,
    occurredAt: Date.parse(data.occurred_at),
    payload: data.payload,
  };
}
export async function readBody(
  request: Request,
  maxBytes = 262_144,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Webhook body exceeds 256 KB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
