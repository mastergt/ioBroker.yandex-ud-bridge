# Maintainer publishing checklist

This package is a **GitHub preparation bundle**, not an npm release.

## Before publishing publicly

- [ ] Replace `OWNER` in README.md with your GitHub username or organization.
- [ ] Review package author, `io-package.json` authors and LICENSE copyright. Do not claim another author's rights.
- [ ] Run a security review of OAuth endpoints, CSRF/redirect handling, public provider API and backup import/export; run a code-secret scan.
- [ ] Check that all test examples use placeholders; remove personal device IDs and private internal URLs.
- [ ] Verify minimum supported ioBroker and Node.js versions using fresh installs.
- [ ] Review Third Party dependencies and npm package contents.
- [ ] Enable private vulnerability reporting in GitHub security settings.

## Publish GitHub source

1. Create a PUBLIC and empty `ioBroker.yandex-ud-bridge` repo on GitHub (no auto-created README/license/gitignore).
2. Extract the prepared source archive, `cd` into its root folder.
3. `git init -b main && git add . && git commit -m "Initial public adapter source v0.3.16"`
4. `git remote add origin https://github.com/OWNER/ioBroker.yandex-ud-bridge.git`
5. `git push -u origin main`
6. Verify GitHub Actions. Do not create a release until CI is green and owner metadata and security checks are complete.
7. Tag only the reviewed commit: `git tag v0.3.16 && git push origin v0.3.16`.
8. Create a GitHub Release from that tag and mark it pre-release if appropriate.

## Further distribution

- GitHub development install: via ioBroker Admin custom-source dialog. Does not require npm publishing.
- npm: first confirm name ownership/availability, create an npm account and release credentials. Follow the current ioBroker recommended release workflow and use npm Trusted Publishing where possible.
- ioBroker Official Latest/Beta: use the current ioBroker.repositories guidelines, forum testing and adapter checker; requires modern config interface and additional metadata/tests. Do not claim inclusion until the PR is accepted.

### Public-release blockers still to decide

The source currently uses the Materialize Admin UI, `Community prototype` author placeholders, and a custom OAuth service. A fresh security review and repository checker are required before requesting official catalog inclusion.
