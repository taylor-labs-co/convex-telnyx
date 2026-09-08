# Calling recipes

These snippets run inside your authenticated app mutations or `onEvent` hook. `scope` must be trusted, and every independent command needs its own stable idempotency key.

## Answer an inbound call and greet the caller

In an internal event mutation, after deliberately enabling inbound answering for an owned number:

```ts
if (event.type === "call.initiated" && event.payload.direction === "incoming") {
  await telnyx.callCommand(
    ctx,
    String(event.payload.call_control_id),
    "answer",
    {},
    {
      scope,
      idempotencyKey: `${event.id}:answer`,
    },
  );
}
if (event.type === "call.answered") {
  await telnyx.callCommand(
    ctx,
    String(event.payload.call_control_id),
    "speak",
    {
      payload: "Welcome. How can we help?",
      voice: "female",
    },
    { scope, idempotencyKey: `${event.id}:greet` },
  );
}
```

The webhook has already created the call record before the hook runs. Filter by your business rules so you do not answer or greet every call unintentionally. The `call.answered` event can also occur for outgoing calls.

## Recording and transcription

```ts
await telnyx.callCommand(
  ctx,
  callControlId,
  "startRecording",
  {
    format: "mp3",
    channels: "dual",
  },
  { scope, idempotencyKey: recordingRequestId },
);

await telnyx.callCommand(
  ctx,
  callControlId,
  "startTranscription",
  {},
  {
    scope,
    idempotencyKey: transcriptionRequestId,
  },
);
```

Consume `call.recording.saved` and `call.transcription` events through `listEvents` or an `onEvent` hook. Recording URLs and transcript fields remain provider JSON. This component does not download recordings. Configure consent and retention appropriate to your product before enabling recording.

## Transfer, bridge and DTMF

```ts
await telnyx.callCommand(
  ctx,
  callControlId,
  "transfer",
  {
    to: "+15555550102",
  },
  { scope, idempotencyKey: transferRequestId },
);

await telnyx.callCommand(
  ctx,
  callControlId,
  "bridge",
  {
    call_control_id_to_bridge_with: otherCallControlId,
  },
  { scope, idempotencyKey: bridgeRequestId },
);

await telnyx.callCommand(
  ctx,
  callControlId,
  "sendDtmf",
  {
    digits: "1234#",
  },
  { scope, idempotencyKey: dtmfRequestId },
);
```

The target call is scoped by the component. Your app must also authorize related IDs inside command parameters, such as the other call in a bridge. Those provider-specific relationships cannot be inferred by a general-purpose component.

## AI assistants and media

`startAIAssistant`, `joinAIAssistant`, `addAIAssistantMessages`, `stopAIAssistant`, `gatherUsingAI`, `startConversationRelay` and `stopConversationRelay` use the official SDK parameter types. Assistant configuration, tool endpoints, sessions and related API resources are accessible through `createTelnyxSDK()` in a Node action.

`startStreaming` and `startForking` configure external media destinations. Convex does not become a media socket server by installing this package. Use your media service's `wss://` endpoint and process the associated lifecycle webhooks here.

## Latency and concurrency

Calls use their own five-worker pool. Queueing makes commands durable but adds scheduling latency. For time-critical call control, call the official SDK from a Node action with an explicit `command_id`, then let signed webhooks update the component's state. That direct path is not covered by the durable operation ledger.

Official references: [Voice API webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks), [Telnyx Node SDK](https://github.com/team-telnyx/telnyx-node).
