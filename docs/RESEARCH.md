# Research and product decisions

Research date: September 7, 2026. This comparison uses primary Convex documentation, official component repositories, the official Telnyx SDK/API documentation, and the public npm downloads API.

## Popularity sample

The npm API reported the following downloads for **August 8–September 6, 2026**. This is a sample of 16 established Convex component packages, not an exhaustive ecosystem ranking. Downloads include CI and transitive dependency installs, so they are neither unique users nor production adoption counts. Workpool is used by other components, which contributes to its total. One candidate, `@convex-dev/push-notifications`, returned 404 and is excluded.

| Component                               | Downloads in sampled window |
| --------------------------------------- | --------------------------: |
| `@convex-dev/workpool`                  |                   1,399,574 |
| `@convex-dev/rate-limiter`              |                   1,306,240 |
| `@convex-dev/migrations`                |                   1,176,484 |
| `@convex-dev/workflow`                  |                     747,362 |
| `@convex-dev/aggregate`                 |                     676,053 |
| `@convex-dev/agent`                     |                     529,717 |
| `@convex-dev/resend`                    |                     472,815 |
| `@convex-dev/crons`                     |                     296,285 |
| `@convex-dev/r2`                        |                     268,047 |
| `@convex-dev/rag`                       |                     250,382 |
| `@convex-dev/action-cache`              |                     233,324 |
| `@convex-dev/presence`                  |                     208,788 |
| `@convex-dev/sharded-counter`           |                     184,644 |
| `@convex-dev/stripe`                    |                     159,742 |
| `@convex-dev/persistent-text-streaming` |                     107,297 |
| `@convex-dev/twilio`                    |                      43,719 |

The raw responses are in [npm-downloads.json](npm-downloads.json). Reproduce a lookup using [the npm downloads API](https://api.npmjs.org/downloads/point/2026-08-08:2026-09-06/@convex-dev/workpool), replacing the package name for other rows.

## What makes the leading components useful

- **Workpool and Workflow:** durable execution, controlled concurrency and retries remove infrastructure work from application code. Adopted here as nested work pools, including a separate voice pool. [Workpool](https://github.com/get-convex/workpool), [Workflow](https://github.com/get-convex/workflow)
- **Rate Limiter:** reusable traffic policy makes provider integrations easier to operate. This package bounds concurrency and responds to explicit provider rate limits. It does not claim to implement per-user abuse controls or a calls-per-second quota; apps should add Rate Limiter for those policies. [Rate Limiter](https://github.com/get-convex/rate-limiter)
- **Migrations and Aggregate:** components encapsulate indexed data maintenance and query patterns that otherwise need repeated custom work. Applied here through owned schemas, indexed access, bounded pagination and explicit retention controls. [Migrations](https://github.com/get-convex/migrations), [Aggregate](https://github.com/get-convex/aggregate)
- **Agent and RAG:** lasting value comes from coordinating persistent state with an external service. For Telnyx, that means a queryable ledger plus message/call state and original event history. [Agent](https://github.com/get-convex/agent), [RAG](https://github.com/get-convex/rag)
- **Resend:** dependable external delivery needs queueing, observability and webhook feedback. This component adopts those patterns while explicitly preserving uncertainty when a telecom request may already have been accepted. [Resend](https://github.com/get-convex/resend)
- **Twilio:** a small integration surface for outbound/inbound communication is valuable. This component adds Telnyx-specific calling, verification, event handling and an SDK escape hatch to that basic convenience. [Twilio](https://github.com/get-convex/twilio)

## Authoring guidance applied

The [Convex component authoring guide](https://docs.convex.dev/components/authoring) informed the isolated component folder, declared environment binding, generated API boundary, client wrapper, function-handle callbacks, package entry points, test helper and build ordering. Component IDs cross the parent boundary as strings. App authentication stays in the parent. Lists use the component-compatible paginator. The example imports the built package, and the npm archive is checked in a separate consumer.

The guide and [official template](https://github.com/get-convex/templates/tree/main/template-component) also establish the expected publishing shape. The package contains the generated component declarations, bundled config, source-based test entry point and normal library entry point.

## Telnyx-specific decisions

The [messaging webhook guide](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks) documents Ed25519 signatures over timestamp plus original payload, retries, duplicate event IDs and out-of-order delivery. The implementation verifies before writing state, retains event IDs, keeps hooks off the response path and protects lifecycle state from late updates. [Voice webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks) supply the call-control event model.

The [message API](https://developers.telnyx.com/api-reference/messages/send-a-message) supports SMS/MMS with multiple sender types and exposes delivery/cost metadata. The official **telnyx 7.20.0** package supplies request types. Its call-control implementation is also the independent request-format reference for 41 command parity tests, including bridge parameter translation and the PUT verb for client-state updates. [Official SDK repository](https://github.com/team-telnyx/telnyx-node)

No universal message-send idempotency guarantee was assumed from these references. The package deduplicates locally, but does not automatically repeat ambiguous paid requests. The full SDK is available separately for breadth; those methods do not magically acquire managed persistence or queueing.

## Scope boundaries

This release builds a reusable communications backend component. It does not provision phone numbers, register campaigns, create real calls, host a media socket server, publish to npm, create a GitHub repository or submit a hosted demo. The primary implementation is tested with mocked provider responses and a real local Convex deployment; a live Telnyx account test remains a distinct verification step.
