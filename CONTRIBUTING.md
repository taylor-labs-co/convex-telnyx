# Development

Use Node 22+ and npm. All generated code is committed so consumers and CI do not require a Convex account.

```sh
npm ci --ignore-scripts
npm run check
npm run test:package
```

To regenerate against an anonymous local backend:

```sh
CONVEX_AGENT_MODE=anonymous npx convex dev --once --typecheck disable
npm run codegen
npm run build
CONVEX_AGENT_MODE=anonymous npx convex dev --once --typecheck-components
```

Generate component code first, build, then deploy the example. Its imports resolve through the package exports into `dist`. The config also imports the packaged config once bootstrapped. For initial component development, temporarily importing `src/component/convex.config.ts` allows the CLI to generate its types.

The optional `example/sdk.node.ts` recipe is kept outside the deployed example functions. Copy it into your own `convex/` directory and adjust the generated-server import when using a deployment with Node actions. It is typechecked here. The core component does not need Node actions.

Tests cover real Ed25519 signatures, state transitions, key deduplication, tenant isolation, network errors, rate limits, official SDK parity for every call command, and a signed HTTP route through a durable application callback. Provider calls are mocked. Never put API credentials in tests or fixtures.

Use `npm run format` after changes. Update generated code after changing function arguments or schema, and update the call parity tests when upgrading the Telnyx SDK. Preserve event/operation deduplication across schema migrations. Review uncertain-outcome semantics before changing retry behavior.
