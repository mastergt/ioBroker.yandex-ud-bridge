# First npm release: iobroker.yandex-ud-bridge v0.3.26

Status: **planned, not yet published**. This checklist must be completed by an npm account owner.
GitHub: https://github.com/mastergt/ioBroker.yandex-ud-bridge
npm name: `iobroker.yandex-ud-bridge`
Version: `0.3.26`
Official Beta (formerly Latest) category: `communication`

## Before publishing

- Verify the adapter works on a real ioBroker installation; pay special attention to the native object picker, OAuth authorization and sensor pressure units.
- Ensure **all CI jobs** on `main` passed (including Windows/macOS and Node 22/24/26).
- Check `package.json` and `io-package.json` both declare `0.3.26`.
- Confirm the repository has an MIT license, maintainer contact, README, Topics, and no private credentials/configs.
- `common.news` lists only `0.3.26` because earlier builds were not published on npm.
- Verify the npm package name is available: `npm view iobroker.yandex-ud-bridge version` should report E404 before the first release.
- Use a machine with a supported Node.js **24 LTS** and a current npm CLI. Avoid publishing from unsupported Node.js 23.
- Enable two-factor authentication on the publisher's npm account.

## 1. Publish once manually (npm account holder)

> The npm registry requires the package to exist **before** you can configure its Trusted Publisher.
> Do **not** add NPM_TOKEN to GitHub. The first publication needs an authenticated npm account; future releases can use OIDC.

```bash
git clone https://github.com/mastergt/ioBroker.yandex-ud-bridge.git
cd ioBroker.yandex-ud-bridge
git checkout main
git pull --ff-only

node --version
npm --version
npm login
npm whoami

# Validate release candidate
node -p "require('./package.json').version"
node -p "require('./io-package.json').common.version"
npm install --no-audit --no-fund
npm run check
npm test
npm pack --dry-run
git status --short

# Save exact tested commit in the release tag.
git tag -a v0.3.26 -m "First npm release: Yandex Smart Home Bridge v0.3.26"
git push origin v0.3.26

# First and only manual publication of this version; npm 2FA may prompt.
npm publish --access public
```

Do not create or move `v0.3.26` if the source differs from the tested release. If `npm publish` fails, inspect the error before retrying; never publish from a different commit with the same tag. npm versions cannot be overwritten.

Verify:
```bash
npm view iobroker.yandex-ud-bridge@0.3.26 version
npm view iobroker.yandex-ud-bridge dist-tags --json
npm owner ls iobroker.yandex-ud-bridge
```

## 2. Complete release metadata and ioBroker owner

- In GitHub **Releases**, create a release based on the already-pushed `v0.3.26` tag.
- Mark it **pre-release** during the community/beta testing phase.
- Follow ioBroker's requirement to invite an emergency npm co-maintainer:
  ```bash
  npm owner add bluefox iobroker.yandex-ud-bridge
  ```
  The invitation must be accepted; being invited is not necessarily the same as being an active owner.

## 3. Enable npm Trusted Publishing (for subsequent releases)

Once the package exists, on npmjs.com open:
**Packages → iobroker.yandex-ud-bridge → Settings → Trusted publishing → GitHub Actions**.

Configure these **case-sensitive** values:

| Field | Value |
| --- | --- |
| GitHub user/org | `mastergt` |
| Repository | `ioBroker.yandex-ud-bridge` |
| Workflow filename | `test-and-release.yml` |
| GitHub environment | Leave blank (unless a release environment is configured) |
| Allowed action | Prefer **stage publish** (manual 2FA approval); direct publish only if explicitly required |

Only the filename is needed, **not** `.github/workflows/`.

**Important:** The repository workflow still has `deploy.if: ${{ false }}`; configuring npm trust does **not** enable releases. Before a later version, propose and review a separate PR that enables a tag-only, OIDC-authenticated deploy job and uses `npm stage publish` (or `npm publish` if approved). Require `id-token: write` for that job. The first publish after configuring the trusted publisher must happen within **2 days**, otherwise npm expires the unused configuration.

## 4. Apply for ioBroker Beta (formerly Latest)

1. Confirm npm can install `iobroker.yandex-ud-bridge`, GitHub release is visible, and all required owners are present.
2. Run https://adapter-check.iobroker.in/ on the GitHub URL again.
3. Request community testing in https://forum.iobroker.net/.
4. Submit `ioBroker/ioBroker.repositories` PR after using the official script:
   ```bash
   npm run addToLatest -- --name yandex-ud-bridge --type communication
   ```
   Or use https://www.iobroker.dev/ → adapter → Manage → **ADD TO LATEST**.
5. Wait for official repository maintainers' review. Inclusion in Stable is a later step requiring independent testing.

Keep credentials, OAuth secrets, backup files, private instance settings, and personal tokens out of public release artifacts.
