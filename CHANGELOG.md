# Changelog

## 0.1.0

Initial release candidate: queued SMS/MMS and group messaging, scheduling, dialing and 41 voice commands, four verification channels, signed webhook ingestion and durable app hooks, scoped reactive records, explicit uncertainty handling, redaction, test helper and optional official SDK access.

### Messaging parity additions (unpublished)

- Default sender/profile options and automatic delivery-webhook URLs.
- Helpers to configure an existing messaging profile and number.
- Indexed incoming/outgoing, sender, recipient and two-way counterparty queries, with bounded backfill.
- Per-send/default submission callbacks, independent retry/redrive and safe result retention.
- Immediate action-based sending with durable idempotency, cached confirmed results and abandonment handling.
