# Comparison with @convex-dev/twilio

Compared with the official [Twilio component client](https://github.com/get-convex/twilio/blob/main/src/client/index.ts) and [message implementation](https://github.com/get-convex/twilio/blob/main/src/component/messages.ts) on September 7, 2026. This is a functional comparison, not a claim of drop-in API or provider compatibility.

| Twilio benefit                                  | Telnyx component API                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Persistent send/receive history and status      | `sendMessage`, `getMessage`, `listMessages`, verified webhooks            |
| Default sender                                  | `defaultFrom` constructor option                                          |
| Automatic outgoing status callback URL          | Automatically applied `webhook_url` from the app site URL/configured path |
| Configure incoming SMS handling through the API | `registerIncomingSmsHandler`, `configureMessagingProfile`                 |
| Incoming/outgoing lists                         | `listIncoming`, `listOutgoing`                                            |
| Messages from/to a number                       | `getMessagesFrom`, `getMessagesTo`                                        |
| Two-way number history                          | `getMessagesByCounterparty`                                               |
| Per-send/default outgoing callback              | `callback`, `defaultOutgoingMessageCallback`, `sentMessageCallbackArgs`   |
| Provider message returned by an action          | `sendMessageNow`                                                          |
| Application behavior on incoming messages       | `registerRoutes({ onEvent })` with the existing verified event hook       |

The provider setup helper configures an existing Telnyx messaging profile and number. It does not buy a number; managed purchasing is still outside this component. Profile-level routing affects every number sharing the profile.

The callback timing is deliberately different: this component stores inbound events before executing the app hook, and stores successful submissions before executing an outgoing callback. Hooks/callbacks then run as retryable mutations whose database effects and completion markers commit atomically. A handler failure cannot erase the confirmed provider result or cause a second send.

`sendMessage` remains a queued API. `sendMessageNow` is the explicit action-based immediate path, retains idempotency and exposes uncertain outcomes, but does not use the send pool's concurrency cap. These are two useful delivery modes, not matching method signatures.

Conversation queries are paginated and scoped. They index group recipients and support a bounded backfill for existing records. Telnyx-specific schemas and payloads differ from Twilio; the library does not return Twilio SIDs or TwiML.

Beyond this comparison, the component includes calling, verification, independent voice queueing, signed event history, deduplication and the full official SDK entry point. Live Telnyx account validation remains separate from the mocked provider tests.
