# Validation record

Validated on September 7, 2026. This is a technical release-preparation record, not evidence of live carrier delivery.

## Passed

- Strict TypeScript checks for the package and backend example.
- ESLint and Prettier checks.
- 118 tests covering queue deduplication, cancellation, tenant boundaries, payload redaction, pagination limits, transport failures, Retry-After handling and uncertain outcomes.
- Messaging defaults, automatic webhook URLs, provider profile/number configuration, indexed conversations, immediate sends and concurrent-send deduplication.
- Submission callback rollback, retries and redrive without repeating provider requests.
- Real Ed25519 signing/verification fixtures, tamper rejection, replay/future timestamps, key rotation and body limits.
- Request parity with official telnyx 7.20.0 for all 41 supported call-control commands: URL, HTTP verb and serialized body.
- Signed HTTP webhook through the example app, component projections and durable callback.
- Callback rollback, retry exhaustion and authorized redrive without duplicate effects.
- Anonymous local Convex deployment of the example importing the built package, including both nested Workpools. The `smoke:check` invocation returned `component: true`, `deduplication: true`, `reactiveState: true`.
- Fresh npm archive installed into an isolated consumer from the archive itself. Checked public exports, consumer TypeScript declarations, normal library/SDK imports, Convex-config bundling and actual execution through the packaged test helper.
- Package file allowlist excludes local deployment configuration, credentials, node_modules and test fixtures.

## Boundaries

Provider HTTP responses are mocked in tests. No real SMS/MMS, calls, verification challenges, number purchases or other paid Telnyx operations were performed. No live Telnyx account credentials were used.

The SDK recipe is typechecked and its Node entry point imports successfully. The optional recipe was not deployed as a Node action: this machine's local Convex runner did not have a supported Node-action runtime configured. The complete managed component and webhook route deploy in the default Convex runtime.

Convex config modules must be evaluated by Convex, which injects component paths. The package check bundles their imports; the local Convex deployment verifies their execution. They are not standalone Node programs.

CI is configured for Node 22 and 24; GitHub CI results are available on the repository Actions tab; the checks below describe local validation. All 118 tests passed locally under both Node 22 (an isolated npm-managed executable) and Node 26.7.0.

No npm publish, directory submission or hosted demo deployment was performed. See PUBLISHING.md for the remaining intentional release steps.
