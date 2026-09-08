# Architecture and guarantees

The package follows Convex's component-authoring layout: `src/component` owns isolated state, `src/client` runs in the parent app, `_generated/component` describes its boundary, and `/test` registers the component and nested dependencies. The separate `/sdk` entry point imports the official Telnyx Node SDK. Its runtime import is deliberately absent from the main entry point.

## State and execution

1. An authorized app mutation calls a typed wrapper with trusted scope and an idempotency key.
2. The component validates the request, hashes its canonical content, reserves the key and enqueues work in one transaction.
3. A Workpool worker claims the operation once, reads the component's bound API key and makes one provider request.
4. A confirmed response updates the resource snapshot and marks the operation successful. Explicit rejection records failure; an ambiguous result records uncertainty.
5. Telnyx's signed webhooks update resource state and append event history independently of the submission response.
6. An optional application mutation processes the event through a retryable Workpool action. Its writes and the event's delivered marker commit atomically.

Operations and provider resources are separate. `succeeded` means the provider accepted the API operation; delivery, call progress and verification state are represented by resource records. Calls are keyed by `call_control_id`. Recordings and transcription payloads are available through event history. The latest resource `data` is a convenience snapshot, not a replacement for ordered event history.

## Storage

- `operations`: scoped idempotency key, request fingerprint, queue state, attempt count, result/error and provider ID.
- `resources`: scoped provider ID and kind, normalized lifecycle status, timestamps and provider JSON.
- `events`: scoped event ID, type, occurrence/receipt timestamps, provider payload and callback delivery state.

All read paths use indexes. Lists use the `convex-helpers` component-compatible paginator and enforce a 100-row maximum. Payload redaction handles at most 100 records per transaction and retains deduplication tombstones. No automatic retention policy is imposed.

The API key is not stored in these tables. The component accesses its declared environment binding at execution time. Direct app-side lookup and verification helpers access the app environment or an explicit constructor option. These must use the same Telnyx account as the instance binding.

## Failure model

There is no atomic transaction spanning Convex and Telnyx. A network failure may occur after a provider accepts a message or call. For this reason, provider operations disable automatic transport retries. Only explicit rate-limit rejections are automatically retried, at most five attempts. Honor `Retry-After` up to a one-day window; never retry early when it exceeds that window.

A crashed worker that claimed work becomes uncertain via its completion callback. A worker failing before claim becomes failed. The current work ID guards against stale completion callbacks. Uncertain operations need provider-side reconciliation. Reusing their original key does not send again; a new key is a new provider request.

Call commands carry stable provider `command_id` values. Their provider-side deduplication semantics are additional protection, not an exactly-once guarantee. Failed hook mutations can be retried safely for database effects; external effects must be scheduled or placed in an outbox, not performed inside mutations.

Terminal message/call states do not regress to intermediate states. Older event payloads do not overwrite newer snapshots. Non-lifecycle call events do not change call lifecycle status. Group-message status derives from all recipients. Full payloads remain in event history, including events too old to update the snapshot.

## Trust boundaries

Component exports are parent-callable function references, not browser endpoints. They cannot authenticate the app's user. The parent must authorize operations, query visibility, scope mapping and administrative sync/redaction. The component additionally scopes target lookup for call commands and scheduled-message cancellation.

HTTP ingestion verifies the original body with Ed25519 and a five-minute timestamp window, then validates the envelope. It supports key rotation and a 256 KiB body limit. Scope resolution occurs only after signature verification. Unknown event types are retained for future SDK features.

Node SDK methods are direct API calls. They do not inherit queueing, state synchronization or component authorization. Browser calling/media transport and persistent WebSocket hosting are outside this package.

## Messaging convenience layer

Message resources now carry optional normalized direction/from/to fields. A `messageContacts` table holds deduplicated sender, recipient and counterparty edges. Queries paginate indexes rather than filtering full message histories. Each message indexes at most 20 recipients; resource redaction removes address edges and normalized phone fields. Existing instances can backfill 100 messages per mutation.

Submission callbacks are attached to operations, not provider delivery events. Successful submission commits the result and schedules the callback. Its mutation effects and delivered marker commit together. Failed callbacks can be redriven; the original send stays successful and is never replayed. Pending or failed callbacks prevent result redaction.

Immediate sends reserve an operation without entering Workpool, execute at most one provider attempt and return the confirmed provider message. A 60-second watchdog expires abandoned reservations or marks interrupted attempts uncertain. Duplicate callers cannot claim work twice. The immediate path does not automatically retry 429s or participate in Workpool concurrency limits.

Webhook setup helpers run in parent actions with parent credentials. They patch existing messaging profiles and number assignments, storing only confirmed configuration snapshots. A shared profile affects all of its numbers. Provider changes and snapshot writes are separate transactions; partial setup is explicitly visible rather than reported as atomic.
