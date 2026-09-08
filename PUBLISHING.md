# Publishing

## First release

The package name is `convex-telnyx`. Authenticate with `npm login`, then run `npm publish --access public` after the checks pass. npm may require security-key or browser authorization. Never commit credentials.

## Automatic releases

`.github/workflows/publish.yml` runs when a GitHub release is published. It checks the release tag against `package.json`, installs dependencies, builds, typechecks, lints, runs the tests, checks formatting, and publishes with provenance. Stable releases use `latest`; GitHub prereleases use `next`.

Configure the package's npm trusted publisher once:

- Provider: GitHub Actions
- Organization: `taylor-labs-co`
- Repository: `convex-telnyx`
- Workflow filename: `publish.yml`
- Environment: leave empty
- Allowed action: direct `npm publish`

This workflow uses short-lived OIDC authentication; no npm token needs to be stored in GitHub. Configuration on npm is required before the workflow can publish.

For subsequent releases:

1. Update the package version and lockfile, changelog and validation record.
2. Push the changes after CI passes.
3. Create a GitHub release with the matching tag, such as `v0.1.1` for package version `0.1.1`.
4. Verify the Publish to npm workflow succeeds and the version appears on npm.

Do not create a release for a version already published manually: npm versions are immutable. Tag the initial manual release without publishing a GitHub release, or let a later release be the first automated publish.

## Convex directory

After npm publication, submit through the [Convex Components directory](https://www.convex.dev/components). Include the npm URL, repository, feature description and a demo link. A backend example is included; a hosted demo and directory submission remain separate tasks.

See [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for account configuration details.
