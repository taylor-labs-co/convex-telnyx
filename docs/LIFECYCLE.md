# Tenant-owned number lifecycle

`telnyx.lifecycle` orchestrates **new, component-owned** messaging profiles, number purchases, 10DLC assignments, and cleanup. Authenticate callers and derive `scope` from server-side tenant membership; never accept an arbitrary client scope. Ownership is exclusive across scopes **within one component installation**. Existing `configureMessagingProfile` / number setup snapshots do not confer lifecycle ownership. Do not manage the same provider resources through multiple component installations or mix direct SDK writes with lifecycle operations.

## Provision and bind

From an app mutation, reserve an application tenant/provisioning record and enqueue a profile operation in the same transaction:

```ts
const operationId = await telnyx.lifecycle.enqueue(
  ctx,
  {
    kind: "profile",
    name: "Acme notifications",
    webhookUrl: "https://your-deployment.convex.site/telnyx/webhook",
  },
  {
    scope: tenantId,
    idempotencyKey: "profile-v1",
    callback: internal.tenants.bindTelnyxResource,
  },
);
```

`enqueue` returns the existing operation for an identical scope/key/request/callback. Changing parameters under that key fails. The webhook must be HTTPS, without credentials, query parameters, or fragments. The provider profile name includes the durable operation ID for recovery; profiles initially allow US destinations. Register the existing signed webhook handler separately and derive inbound scope from your tenant binding.

After the profile operation succeeds, enqueue a number acquisition:

```ts
await telnyx.lifecycle.enqueue(
  ctx,
  {
    kind: "number",
    phoneNumber: "+15555550100",
    messagingProfileId: profileId,
  },
  { scope: tenantId, idempotencyKey: "primary-number-v1" },
);
```

The profile must belong to that scope and not be deleted. Acquisition reserves the phone number globally in this component and locks the profile until resolved. Conflicting operations fail rather than racing; retry enqueue after the conflicting operation is resolved. An already-owned active number cannot be purchased again using a different key. Search/selection of available inventory remains an app-owned SDK step; inventory may change before ordering.

The worker stores `submitted` **before** contacting Telnyx. Number orders carry the operation ID as `customer_reference`; their reference is persisted before dependent routing work. Delayed orders are polled every 30 seconds. Purchase completion requires a successful matching order, the owned number ID, and confirmed messaging-profile routing—not just an accepted order response.

## Recovery and snapshots

- `get(ctx, scope, operationId)` reads one operation; another scope receives `null`.
- `list(ctx, scope, paginationOpts)` discovers operations, including late results and abandoned app flows.
- `resources(ctx, scope)` returns owned resource snapshots, including confirmed deletion tombstones.
- Legacy setup/configuration getters remain separate views; use lifecycle snapshots for resources provisioned here.
- `reconcile(ctx, scope, operationId)` schedules another reconciliation for pending, uncertain, or failed operations. It never resets `submitted` or blindly repeats a create.

`pending` means more provider reads are scheduled. `uncertain` requires explicit reconciliation; a worker abandoned for five minutes also becomes uncertain. Recovery without a saved provider ID uses an exact, unique correlation match. Incomplete/ambiguous lookup results remain unresolved. No match is **not** evidence that a purchase failed. Do not use a new key to bypass an unresolved purchase. Uncertain outcomes retain resource locks conservatively. A failed operation releases its locks only with affirmative `noEffect` evidence (for example, an initial rejected purchase or a preflight identity mismatch); that operation cannot be reconciled again, so correct the request and use a new key. Failures without that evidence remain locked and reconcilable; operator intervention may be necessary for provider-side inconsistencies. Read-only preflight failures may safely retry before an assignment is submitted. There is intentionally no unsafe “force repurchase” or ownership-adoption endpoint.

Snapshots and successful operation state commit together, independently of callbacks. Optional mutation callbacks receive `{ scope, operationId, snapshot }`; use the exported `lifecycleSnapshotValidator` for the snapshot argument. Callback app writes and the delivered marker commit atomically. If the callback fails, fix it and call `redriveCallback(ctx, scope, operationId)`. This retries only the mutation, not the purchase. Callback delivery status is the `delivered` boolean. Keep a tenant provisioning/deletion tombstone so a late callback cannot resurrect a deleted tenant; the callback should check the application's current lifecycle generation before binding the result.

## 10DLC

Use the typed `lookupBrand` and `lookupCampaign` provider helpers from the main package inside an authorized action (they use the component deployment's `TELNYX_API_KEY` environment value in that action). Registration submission and operator approval remain app-owned.

```ts
await telnyx.lifecycle.enqueue(
  ctx,
  {
    kind: "assignCampaign",
    resourceId: ownedNumberId,
    phoneNumber: "+15555550100",
    campaignId,
    brandId,
  },
  { scope: tenantId, idempotencyKey: "campaign-v1" },
);
```

Assignment verifies provider identities, the campaign/brand relationship and approval, and the owned phone number. Activation is confirmed only after Telnyx reports the matching assignment as assigned. A lost assignment response is reconciled by lookup, not blindly recreated. Approval of a provider identity does not authorize a tenant to use it: the app must authorize the supplied brand/campaign IDs for that tenant before enqueueing.

## Confirm cleanup before deleting the tenant

Enqueue `{ kind: "releaseNumber", resourceId: ownedNumberId }`, then wait for `succeeded`. Release requires a provider lookup confirming absence (404), not merely a DELETE acknowledgement. Reconciliation after a lost successful DELETE response recognizes absence. Repeat for every number, then enqueue `{ kind: "deleteProfile", resourceId: profileId }`. Profile deletion is rejected while any owned number remains active or provisioning holds its lock. Only after all cleanup operations succeed should the app finalize tenant deletion. Keep operation records, keys, and resource tombstones for replay and late-result handling; generic message retention does not purge lifecycle state.

## Scopes, profiles, and managed accounts

A **scope** is a component authorization partition, not a Telnyx account. A **messaging profile** configures routing within the account; it is not a billing or credential boundary. All lifecycle workers use the component's bound `TELNYX_API_KEY`, never credentials in queued arguments. Strict request validators reject extra credential fields; do not put secrets in free-text names, keys, or callback handles.

For a provider-level account boundary, Telnyx requires explicit manager-account approval. The optional `convex-telnyx/sdk` entry point exposes typed `sdk.managedAccounts.create`, `.retrieve`, `.update`, `.list`, and `.actions.enable` / `.actions.disable`. The installed Telnyx SDK does **not** expose managed-account deletion; disabling an account is not confirmed resource cleanup. These account APIs are direct, **not** part of this durable orchestrator. Managed-account responses can contain API keys/tokens: store credentials only in an appropriate secret store, never operation arguments or snapshots. Bind a separate component installation to each managed account's credentials. Do not infer account teardown from deleting a messaging profile.

## Verification boundary

Tests use deterministic provider-response fixtures and `convex-test`, not paid live purchases or a live carrier registration. Provider-side eventual consistency, account eligibility, US number availability, and carrier approvals must still be validated in the deploying account. Component code generation requires a configured Convex deployment; the checked-in API declarations include the lifecycle surface for offline builds.
