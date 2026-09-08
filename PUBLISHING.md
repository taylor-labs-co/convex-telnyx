# Publishing convex-telnyx

The package is prepared as version 0.1.0. Preparation does not publish it. The unscoped npm name returned 404 when checked on September 7, 2026; this is not a reservation and must be rechecked at release time.

## Release checklist

1. Review README, license, changelog and the validation record. Repository, homepage and issue links point to `taylor-labs-co/convex-telnyx`. Add author metadata if desired.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm run format:check`, and `npm run test:package`.
3. Run `npm pack --dry-run` and inspect the file list. Environment files, local deployment state, test fixtures and node_modules must not be included.
4. For provider verification, configure a dedicated Telnyx test account/number and exercise real outbound/inbound messaging, a call and its webhook lifecycle, and a verification challenge. Unit tests mock provider calls; they do not establish carrier delivery or account eligibility. These operations can incur provider charges.
5. Log into the npm account that should own the name: `npm login`. Verify with `npm whoami` and recheck the name with `npm view convex-telnyx`.
6. Publish intentionally: `npm publish --access public`. `prepublishOnly` runs the build, type checks, lint and tests.
7. Tag the published version and push it to your chosen repository. Do not tag or push to an invented remote.

For an alpha release, change the version to `0.1.0-alpha.0` and publish with `--tag alpha`. Use npm trusted publishing and provenance when your actual repository and publishing workflow are configured; this project does not contain tokens or an automatic publishing workflow.

## Convex directory

After npm publication, submit the package through the [Convex Components directory](https://www.convex.dev/components). Prepare the npm URL, repository, concise feature description and a demo link. A backend example is included locally; no hosted demo or directory submission has been created.
