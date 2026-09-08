import type TelnyxSDK from "telnyx";
import { v } from "convex/values";
export const callCommands = [
  "answer",
  "bridge",
  "updateClientState",
  "enqueue",
  "startForking",
  "stopForking",
  "gather",
  "stopGather",
  "gatherUsingAI",
  "gatherUsingAudio",
  "gatherUsingSpeak",
  "hangup",
  "leaveQueue",
  "startPlayback",
  "stopPlayback",
  "pauseRecording",
  "resumeRecording",
  "startRecording",
  "stopRecording",
  "refer",
  "reject",
  "sendDtmf",
  "sendSipInfo",
  "startSiprec",
  "stopSiprec",
  "speak",
  "startStreaming",
  "stopStreaming",
  "startNoiseSuppression",
  "stopNoiseSuppression",
  "switchSupervisorRole",
  "startTranscription",
  "stopTranscription",
  "transfer",
  "startAIAssistant",
  "stopAIAssistant",
  "addAIAssistantMessages",
  "joinAIAssistant",
  "startConversationRelay",
  "stopConversationRelay",
  "pay",
] as const;
export type CallCommand = (typeof callCommands)[number];
export type CallCommandParams<C extends CallCommand> = Parameters<
  TelnyxSDK["calls"]["actions"][C]
>[1];
export type SendMessageParams = Parameters<TelnyxSDK["messages"]["send"]>[0];
export type DialParams = Parameters<TelnyxSDK["calls"]["dial"]>[0];
export type VerificationChannel = "sms" | "call" | "flashcall" | "whatsapp";
export interface VerificationParams {
  sms: Parameters<TelnyxSDK["verifications"]["triggerSMS"]>[0];
  call: Parameters<TelnyxSDK["verifications"]["triggerCall"]>[0];
  flashcall: Parameters<TelnyxSDK["verifications"]["triggerFlashcall"]>[0];
  whatsapp: Parameters<
    TelnyxSDK["verifications"]["triggerWhatsappVerification"]
  >[0];
}
export const webhookEventValidator = v.object({
  id: v.string(),
  type: v.string(),
  occurredAt: v.number(),
  payload: v.any(),
});
export interface WebhookEvent {
  id: string;
  type: string;
  occurredAt: number;
  payload: Record<string, unknown>;
}
/** Produce Convex-compatible JSON, dropping SDK optional undefined fields. */
export function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function validateOperation(
  method: string,
  request: unknown,
  target?: string,
) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("request must be an object");
  const body = request as Record<string, unknown>;
  const allowed = [
    "messages.send",
    "messages.sendGroupMms",
    "messages.schedule",
    "messages.cancelScheduled",
    "calls.dial",
    "verification.sms",
    "verification.call",
    "verification.flashcall",
    "verification.whatsapp",
    ...callCommands.map((x) => `calls.${x}`),
  ];
  if (!allowed.includes(method))
    throw new Error("Unsupported Telnyx operation");
  if (
    (method.startsWith("calls.") && method !== "calls.dial") ||
    method === "messages.cancelScheduled"
  ) {
    if (!target?.trim()) throw new Error("A target ID is required");
  }
  if (
    method === "calls.dial" &&
    (!body.to || !body.from || !body.connection_id)
  )
    throw new Error("Dial requires to, from and connection_id");
  if (
    ["messages.send", "messages.schedule", "messages.sendGroupMms"].includes(
      method,
    )
  ) {
    if (!body.to || (!body.from && !body.messaging_profile_id))
      throw new Error("Message requires to and from or messaging_profile_id");
    if (
      !body.text &&
      !(Array.isArray(body.media_urls) && body.media_urls.length)
    )
      throw new Error("Message requires text or media_urls");
  }
  if (
    method.startsWith("verification.") &&
    (!body.phone_number || !body.verify_profile_id)
  )
    throw new Error("Verification requires phone_number and verify_profile_id");
  if (body.custom_code !== undefined)
    throw new Error(
      "Use the official SDK directly for custom verification codes; the durable queue does not store OTP secrets",
    );
  if (new TextEncoder().encode(JSON.stringify(request)).length > 128_000)
    throw new Error("Operation request exceeds 128 KB");
}
/** A group MMS is delivered only when every recipient is delivered. */
export function messageStatus(data: any): string | undefined {
  const statuses = Array.isArray(data?.to)
    ? data.to
        .map((to: any) => to?.status)
        .filter((s: unknown): s is string => typeof s === "string")
    : [];
  if (!statuses.length) return undefined;
  if (statuses.every((s: string) => s === statuses[0])) return statuses[0];
  const terminal = new Set([
    "delivered",
    "delivery_failed",
    "sending_failed",
    "failed",
    "canceled",
  ]);
  if (statuses.every((s: string) => terminal.has(s)))
    return statuses.includes("delivered")
      ? "partially_delivered"
      : "delivery_failed";
  if (statuses.some((s: string) => s === "sent" || s === "delivered"))
    return "sent";
  return "queued";
}
export function validatePage(numItems: number) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 100)
    throw new Error("Page size must be an integer from 1 to 100");
}

/** Args for an internal mutation invoked after a confirmed message submission. */
export const sentMessageCallbackArgs = {
  scope: v.string(),
  operationId: v.string(),
  message: v.any(),
};
