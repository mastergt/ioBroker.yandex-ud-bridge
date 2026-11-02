# Maintainer release and publishing checklist

Maintainer: **Sergey Batayshchikov** (GitHub: [@mastergt](https://github.com/mastergt)).  
Project: [ioBroker.yandex-ud-bridge](https://github.com/mastergt/ioBroker.yandex-ud-bridge).

This is a maintainer checklist, **not** an indication that the adapter is already published to npm or included in the official ioBroker repositories.

## Before the first npm publication

- [x] Migrate instance settings to Admin 3 JSON Config (v0.3.17) and modern standalone HTML device tab without Materialize (v0.3.18). **Discuss the optional Admin sidebar with reviewers.**
- [ ] Validate the adapter with [ioBroker Adapter Checker](https://adapter-check.iobroker.in/) and fix blockers.
- [x] Add package/install/integration test *jobs* to GitHub Actions (run CI and resolve failures); verify clean startup, unload, and compact mode; see [TESTING.md](TESTING.md).
- [ ] Audit OAuth redirects, authorization, public HTTP routes, rate limiting, data validation and secret handling. Review backup export/import security.
- [ ] Verify installation on a fresh ioBroker and supported Node.js versions.
- [ ] Verify documentation and asset links, GitHub topics, license, author fields and `npm pack --dry-run` contents.
- [ ] Confirm the version has never been published to npm by another owner.

## Release preparation

1. Update version in `package.json` and `io-package.json` together, and add a **public-facing** entry to `CHANGELOG.md` and `common.news`. Do not publish internal development history.
2. Run:

   ```bash
   npm install
   npm run check
   npm test
   npm pack --dry-run
   ```

3. Review [GitHub Actions](https://github.com/mastergt/ioBroker.yandex-ud-bridge/actions), the package contents, and the diff for secrets/private configuration data.
4. Commit the validated release and create a Git tag matching the version, e.g. `v0.3.18`, **only once that exact code is ready for release**.
5. Create a GitHub Release for the tag. Mark it as a pre-release when beta testing.
6. Publish to npm using the authenticated maintainer account or npm Trusted Publishing once configured. Do not publish automatically from unreviewed commits.
7. Per [ioBroker.repositories](https://github.com/ioBroker/ioBroker.repositories), invite `bluefox` as an npm package owner:

   ```bash
   npm owner add bluefox iobroker.yandex-ud-bridge
   ```

   Wait for the invitation to be accepted.

## Apply for the ioBroker Latest/Beta repository

- Confirm that Adapter Checker and integration CI are green and that the npm package is available.
- Announce the adapter and request testing on the [ioBroker forum](https://forum.iobroker.net/).
- Fork [`ioBroker/ioBroker.repositories`](https://github.com/ioBroker/ioBroker.repositories), install dependencies and run:

  ```bash
  npm run addToLatest -- --name yandex-ud-bridge --type communication
  ```

- Open a Pull Request for the generated `sources-dist.json` change. Alternatively use [iobroker.dev](https://www.iobroker.dev/).
- The official Latest acceptance is controlled by the ioBroker maintainers. Later Stable inclusion needs separate testing, feedback and PR.

## Current blockers after metadata cleanup

Instance settings use **JSON Config** and the device tab now uses vanilla **HTML/CSS/JS** without Materialize. The server uses standard `bind`/`port` with a legacy migration. Remaining: official review of the optional Admin sidebar and package/integration CI. Its network-exposed OAuth/HTTP code also needs a dedicated security review; see [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Preserve existing settings and stored credentials during any migration. This document is a checklist, not a publication approval.
