# convex-telnyx

Telnyx messaging and calling with a durable queue, verified webhooks, and reactive state in Convex.

Send an SMS or MMS, place a call, control it, and observe the result from a Convex query. The component owns its tables, deduplicates requests and events, and handles background work. Your app owns authentication, tenant membership, and business rules.

## Features

- **Tenant lifecycle:** durable, ownership-checked profile creation, number acquisition, 10DLC assignment, confirmed cleanup, and recoverable tenant-binding hooks. See [lifecycle orchestration](docs/LIFECYCLE.md) for recovery and managed-account boundaries.
- **Messaging:** SMS/MMS, group MMS, default senders, automatic status-webhook URLs, provider scheduling/cancellation, immediate action-based sending, and retryable per-send callbacks.
- **Voice:** dialing and 41 typed commands, including answer, hangup, bridge, transfer, speech, playback, DTMF, recording, transcription, streaming, queues, SIPREC, AI assistants and conversation relay.
- **Verification:** SMS, voice call, flash call and WhatsApp challenges; check a code without storing it in the component.
- **Webhooks:** Ed25519 signatures over the original body, five-minute timestamp checks, key rotation, duplicate detection, durable event history, atomic mutation hooks, retries and failed-hook redrive. Unknown event types are retained too.
- **Reliability:** separate five-worker messaging/general and voice pools; tenant-scoped idempotency keys; delayed work and cancellation; explicit handling of uncertain provider outcomes.
- **Reactive data:** paginated operations, messages, calls, verifications and events; indexed incoming/outgoing lists and two-way per-number conversations; terminal-state protection and group delivery summaries.
- **Full Telnyx access:** optional official SDK entry point for numbers, profiles, conferences, fax, porting, AI and other APIs. SDK calls are direct and are not automatically queued or persisted.
- **Setup helpers:** configure an existing messaging profile and attach an owned number to it from a Convex action, with confirmed configuration snapshots.
- **Testing and privacy:** `convex-test` registration helper and bounded payload redaction that preserves deduplication IDs.

## Install

Requires Convex **1.45 or newer**. Development and the optional Node SDK use Node 22 or newer. The core component runs in Convex's default runtime. No React dependency is required.

```sh
npm install convex-telnyx
```

Bind the app's API key to the component instance. Declared environment variables let credentials stay out of operation records and scheduled function arguments.

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import telnyx from "convex-telnyx/convex.config";

const app = defineApp({
  env: { TELNYX_API_KEY: v.optional(v.string()) },
});
app.use(telnyx, { env: { TELNYX_API_KEY: app.env.TELNYX_API_KEY } });
export default app;
```

```sh
npx convex env set TELNYX_API_KEY 'YOUR_API_KEY'
npx convex env set TELNYX_PUBLIC_KEY 'YOUR_BASE64_PUBLIC_KEY'
npx convex dev
```

Missing API keys let you deploy and test webhooks; queued provider operations then fail explicitly. Separate installations can bind different API keys.

## Defaults and automatic webhook setup

```ts
export const telnyx = new Telnyx(components.telnyx, {
  defaultFrom: process.env.TELNYX_FROM_NUMBER,
  defaultMessagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID,
  webhookPath: "/telnyx/webhook", // This is also the default.
  // For a local deployment, set webhookUrl to a public HTTPS tunnel endpoint.
});
```

Sending automatically attaches `CONVEX_SITE_URL + webhookPath` as `webhook_url`. An explicit message `webhook_url` wins. Set `use_profile_webhooks: true` to use your provider profile's routing instead. An explicit `messaging_profile_id` without `from` selects a number pool; the component does not add `defaultFrom` to that request.

Register the matching HTTP route with `registerRoutes`. For custom paths, configure `webhookPath` on the constructor; a mismatched `registerRoutes.path` throws rather than silently routing status events elsewhere. A custom absolute `webhookUrl` is also supported, and its pathname becomes the default route path. Telnyx must be able to reach that HTTPS URL.

From an **authorized action**, configure a number you already own:

```ts
await telnyx.registerIncomingSmsHandler(ctx, {
  scope,
  phoneNumberId: "YOUR_TELNYX_NUMBER_ID",
  messagingProfileId: "YOUR_MESSAGING_PROFILE_ID",
});
```

This sets the profile's webhook URL/API version to the component endpoint, then assigns the number to the profile. Omit `messagingProfileId` to use the constructor default or discover the number's current profile. `configureMessagingProfile(ctx, { scope, messagingProfileId })` updates just the profile. Both accept an optional `webhookFailoverUrl`.

Authorize ownership before invoking either helper. **Changing a profile changes webhook routing for every number sharing that profile.** It is not a per-tenant setting unless you deliberately use separate profiles. These helpers do not purchase numbers or create profiles.

`getMessagingProfile` and `getPhoneNumber` return scoped snapshots of confirmed setup steps. If profile configuration succeeds but number assignment fails, the profile change remains; the number is not recorded as configured. These provider API operations are not one atomic transaction. They are not automatically retried.

## Send a message

```ts
// convex/messaging.ts
import { Telnyx } from "convex-telnyx";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { components } from "./_generated/api";

export const telnyx = new Telnyx(components.telnyx);

export const send = mutation({
  args: { to: v.string(), text: v.string(), requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) throw new Error("Sign in first");
    const from = process.env.TELNYX_FROM_NUMBER;
    if (!from) throw new Error("Set TELNYX_FROM_NUMBER");
    return telnyx.sendMessage(
      ctx,
      { from, to: args.to, text: args.text },
      {
        scope: user.tokenIdentifier,
        idempotencyKey: args.requestId,
      },
    );
  },
});
```

The returned string is a **local operation ID**, not a Telnyx message ID. Query `getOperation(ctx, scope, id)` to observe `queued → running → succeeded | failed | uncertain`. Successful submission does not imply delivery; inspect the message resource and its webhook-updated status. Operations may also be `canceled`.

Reuse an idempotency key for the same logical request, including after client retries. Reusing it with changed parameters throws. Keys are scoped to a tenant and remain reserved after payload redaction. Generate them outside a retrying Convex mutation, for example with `crypto.randomUUID()` in the client.

Add `media_urls` for MMS. Supply `messaging_profile_id` instead of `from` to use an appropriately configured number pool. `sendGroupMms` accepts the official SDK's group parameters. `scheduleMessage` uses Telnyx's `send_at`; `cancelScheduledMessage` cancels a provider-scheduled message. The operation option `runAt` instead delays local submission and can be canceled using `cancelOperation` before a worker claims it.

## Immediate sending and per-send callbacks

`sendMessage` still queues work and returns an operation ID. When an action needs the provider's message immediately, use:

```ts
const message = await telnyx.sendMessageNow(
  ctx,
  {
    to: "+15555550101",
    text: "Hello!",
  },
  { scope, idempotencyKey: requestId },
);
// message.id is the Telnyx message ID.
```

The immediate path reserves the same kind of durable idempotency record but does not enter the background send pool. Repeating a confirmed request returns its stored result. A concurrent caller may receive `MessageSendError` with the operation ID and current status; it does not send again. Immediate 429s fail without background retries. Timeouts/5xx responses remain uncertain. An abandoned reservation expires after 60 seconds without resending. Immediate sending has no `runAt` option and bypasses Workpool concurrency limits; rate-limit public app actions as appropriate.

Attach a callback to an individual queued, group, scheduled, or immediate send:

```ts
await telnyx.sendMessage(
  ctx,
  { to, text },
  {
    scope,
    idempotencyKey: requestId,
    callback: internal.messaging.onSent,
  },
);
```

```ts
import { sentMessageCallbackArgs } from "convex-telnyx";
export const onSent = internalMutation({
  args: sentMessageCallbackArgs,
  returns: v.null(),
  handler: async (ctx, { scope, operationId, message }) => {
    // Update your app's records after Telnyx confirms submission.
    return null;
  },
});
```

Set `defaultOutgoingMessageCallback` on the constructor to apply one to every send. A per-send callback overrides it; `callback: null` disables it for that send. The callback runs after confirmed **submission**, independently of delivery webhooks. Callback mutation writes and its delivered marker commit atomically. It retries up to five times without repeating the provider send. Inspect the operation's `callbackStatus` and call `redriveSendCallback(ctx, scope, operationId)` after fixing a failed callback. Pending/failed callback results are retained when redaction is requested. Immediate sending returns the provider result without waiting for its callback.

## Calling

These calls belong inside authorized app mutations. `scope` must be derived from your app's trusted membership or ownership data.

```ts
const operationId = await telnyx.dial(
  ctx,
  {
    connection_id: process.env.TELNYX_CONNECTION_ID!,
    from: process.env.TELNYX_FROM_NUMBER!,
    to: "+15555550101",
  },
  { scope, idempotencyKey: requestId },
);

// After the call exists in this scope (from the dial response or a webhook):
await telnyx.callCommand(
  ctx,
  callControlId,
  "speak",
  {
    payload: "Hello from Convex!",
    voice: "female",
  },
  { scope, idempotencyKey: speechRequestId },
);

await telnyx.callCommand(
  ctx,
  callControlId,
  "hangup",
  {},
  {
    scope,
    idempotencyKey: hangupRequestId,
  },
);
```

Command parameters come from the official Telnyx SDK types. `callCommands` exports the complete allowlist. The component supplies a stable `command_id` unless you provide one. Commands and cancellation reject targets absent from the requested scope. Existing calls created outside this component can be added through a verified webhook or the parent-only `components.telnyx.resources.sync` API after checking ownership.

Voice commands have a separate queue from messaging. They still have scheduling latency: use the SDK directly for commands that require the lowest possible latency. Streaming commands configure a media destination; Convex HTTP actions do not host a persistent media WebSocket server. Point `stream_url` at your own compatible media service.

See [calling recipes](docs/CALLING.md) for inbound answering, recording, transcription and AI assistants.

## Receive webhooks

```ts
// convex/http.ts
import { httpRouter } from "convex/server";
import { telnyx } from "./messaging";
import { internal } from "./_generated/api";

const http = httpRouter();
telnyx.registerRoutes(http, {
  path: "/telnyx/webhook",
  publicKey: () => process.env.TELNYX_PUBLIC_KEY ?? "",
  scope: "my-workspace", // Single-workspace example; see tenant routing below.
  onEvent: internal.events.onTelnyxEvent, // Optional.
});
export default http;
```

Configure your Telnyx messaging profile and Voice API application to send API v2 webhooks to `https://YOUR_DEPLOYMENT.convex.site/telnyx/webhook`. The `.convex.cloud` URL is not the HTTP-action URL. Configure a failover URL where appropriate. Local development needs a public HTTPS tunnel for real provider webhooks.

```ts
// convex/events.ts
import { v } from "convex/values";
import { webhookEventValidator } from "convex-telnyx";
import { internalMutation } from "./_generated/server";

export const onTelnyxEvent = internalMutation({
  args: { scope: v.string(), event: webhookEventValidator },
  returns: v.null(),
  handler: async (ctx, { scope, event }) => {
    // Update your app's tables or enqueue a reply/call command here.
    // event.payload contains the original provider payload.
    return null;
  },
});
```

The HTTP route verifies the signature, commits state and queues the optional hook before returning 204. It does not wait for the hook. Hook mutations run in the same transaction as marking the event delivered, so a failed attempt rolls back the hook's database writes. They are retried up to five times. Inspect failed events through the component API, fix the handler, then call `redriveEvent(ctx, scope, eventId)`. This does not replay already delivered hooks.

Return an array of public keys during rotation. Bodies larger than 256 KiB are rejected. Malformed or unsigned events are rejected without writing state. All valid event types are retained; managed resource projections cover messaging, call lifecycle and verification events.

### Tenant routing

Every operation and resource is scoped. A scope is an identifier, **not authentication**. Authorize users in your app; never accept an unchecked tenant ID from the browser. The webhook route can resolve scope asynchronously from the **verified** payload:

```ts
scope: async (ctx, event) => {
  // Look up the messaging_profile_id, connection_id, or your owned phone number
  // in an indexed tenant mapping. Throw if there is no trustworthy mapping.
  return await ctx.runQuery(internal.tenants.forTelnyxEvent, {
    eventType: event.type,
    payload: event.payload,
  });
};
```

Use the same scope for sending and receiving. A single static webhook scope must not be combined with per-user sending scopes. Do not route by unvalidated `client_state` alone. For separate Telnyx accounts, mount separate component instances and webhook routes with the matching account public keys.

## Verification and lookup

```ts
await telnyx.startVerification(
  ctx,
  "sms",
  {
    phone_number: "+15555550101",
    verify_profile_id: process.env.TELNYX_VERIFY_PROFILE_ID!,
  },
  { scope, idempotencyKey: requestId },
);
```

Channels: `sms`, `call`, `flashcall`, `whatsapp`. After submission succeeds, use its provider resource ID with `checkVerification(ctx, { scope, verificationId, code })` from an authenticated, rate-limited **action**. This helper reads the API key from the app environment or the constructor's `apiKey` option; the key must identify the same account as the installed component. Apply your own attempt limits before accepting codes. Custom OTP codes are not accepted by the durable queue.

`lookupNumber(phoneNumber)` is an action-only provider read. Lookup and direct verification checks do not use the background queue.

## Query and manage state

| Method                                 | Purpose                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `getOperation`, `listOperations`       | Submission result, provider resource ID, attempts and failure state |
| `getMessage`, `listMessages`           | Inbound/outbound messages, delivery, costs and media metadata       |
| `getCall`, `listCalls`                 | Call lifecycle and latest merged provider fields                    |
| `getVerification`, `listVerifications` | Verification state                                                  |
| `listEvents`                           | Original event history, optionally filtered by provider resource ID |
| `refreshMessage`                       | Refresh a known scoped message from Telnyx in an action             |
| `cancelOperation`                      | Cancel unclaimed local work                                         |
| `redriveEvent`                         | Retry a failed app event hook                                       |

For SMS inboxes and conversations, use `listIncoming(ctx, scope, paginationOpts)`, `listOutgoing(...)`, `getMessagesTo(ctx, scope, phoneNumber, paginationOpts)`, `getMessagesFrom(...)`, and `getMessagesByCounterparty(...)`. The last method combines messages received from and sent to that number. Each lookup is indexed and tenant-scoped. Group messages appear once per queried recipient. Up to 20 recipient addresses per message are indexed; these are message-history queries, not a separate conversation/session model.

**Existing instances:** run `backfillMessageIndexes(ctx, scope, { cursor, numItems: 100 })` page-by-page until `isDone`. Optional schema fields keep existing documents deployable, but old messages need backfill before the new filtered queries include them. New sends and webhooks maintain indexes automatically. Redacting a resource also removes its indexed phone addresses.

List methods take `{ cursor: null, numItems: 25 }` and return `{ page, continueCursor, isDone }`. Page size is bounded to 1–100. Wrap them in authenticated Convex queries for realtime subscriptions. For React pagination, use `usePaginatedQuery` from `convex-helpers/react`, as recommended for component pagination. A single-page `useQuery` works normally.

Provider-specific fields are stored in `data`/`payload` as opaque JSON. They can evolve independently of the component. The normalized `status` is protected from late events; group MMS can be `partially_delivered`. Call recording/transcription events remain in event history even when a newer lifecycle snapshot already exists.

## Retry semantics

- Requests are deduplicated transactionally within Convex; this is not a claim of exactly-once execution at Telnyx.
- Explicit HTTP 429 responses are retried with `Retry-After` or exponential backoff, for at most five attempts. A requested delay longer than one day fails for manual follow-up instead of retrying early.
- Most other HTTP 4xx responses fail permanently.
- Network failures, timeouts, HTTP 408 and 5xx responses become `uncertain`. A crashed worker is also marked uncertain after claiming work.
- No automatic retry occurs for uncertain requests. Confirm the provider outcome using Telnyx logs/detail records before deciding whether a new request is appropriate. Voice command IDs provide an additional provider-side safeguard, not an unlimited retry guarantee.
- A submitted message or answered call cannot be undone by canceling its local operation.

## Official SDK escape hatch

```ts
// convex/provider.ts
"use node";
import { createTelnyxSDK } from "convex-telnyx/sdk";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const numbers = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const sdk = createTelnyxSDK();
    return JSON.parse(JSON.stringify(await sdk.phoneNumbers.list()));
  },
});
```

This is the full official SDK, with automatic retries disabled by default. Import `/sdk` only into Node action modules. The main entry point uses no Node APIs. SDK calls do not automatically create component resources; rely on verified webhooks or explicitly sync authorized resources.

## Retention and testing

Payloads may contain message text, phone numbers, recording URLs, or transcripts. Nothing is deleted automatically. Call `components.telnyx.maintenance.redact` from an authorized internal mutation with `scope` and up to 100 combined `operationIds`, `eventIds`, and `resourceIds`. It clears completed payloads while retaining idempotency/event tombstones. Queued/running operations and pending/failed hooks or submission callbacks are skipped. Future provider events can populate resource fields again; redaction is not a permanent suppression rule.

```ts
import { convexTest } from "convex-test";
import telnyxTest from "convex-telnyx/test";
const t = convexTest(schema, modules);
telnyxTest.register(t); // Registers nested work pools too.
```

The included example exercises the built package. See [Twilio feature comparison](docs/TWILIO_PARITY.md), [development](CONTRIBUTING.md), [research](docs/RESEARCH.md), [architecture](docs/ARCHITECTURE.md), and [publishing](PUBLISHING.md).

This is an independent community component, not an official Telnyx or Convex package.
