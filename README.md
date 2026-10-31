# ioBroker Yandex Smart Home Bridge

[![CI](https://github.com/OWNER/ioBroker.yandex-ud-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/ioBroker.yandex-ud-bridge/actions/workflows/ci.yml)

An unofficial ioBroker adapter that exposes ioBroker device states to a **private Yandex Smart Home provider skill**. Includes a built-in OAuth 2.0 authorization server, device editor, two-way value mapping, state availability rules, action tracing, and adapter configuration backup/restore.

> **Independent community project.** Not affiliated with or endorsed by Yandex or the ioBroker project. This version has not yet been accepted into the official ioBroker adapter repository.

[Russian documentation](README.ru.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [Release notes](CHANGELOG.md)

## Requirements

- ioBroker with js-controller 5+ and Admin 6+.
- Node.js 20+ (see `package.json` for the supported range).
- Your own Yandex Smart Home provider skill, configured in Yandex Dialogs.
- An externally accessible HTTPS endpoint with reverse proxying to the adapter's HTTP listener. The adapter defaults to `127.0.0.1:8096`.
- Existing ioBroker state objects for the devices you want to expose.

## Install a development release from GitHub

Once the repository is public, in ioBroker Admin open **Adapters > Install from custom source (Octocat) > From GitHub** and enter the repository address:

`https://github.com/OWNER/ioBroker.yandex-ud-bridge`

This is a development-channel install, outside the official ioBroker repository. Back up your ioBroker installation before testing. Repository owner `OWNER` must be replaced with the real GitHub username or organization.

For maintainers, an alternative is to install from a tagged GitHub source URL, using the ioBroker Admin custom-source dialog. Do not follow old `npm install` commands for a production ioBroker installation unless you explicitly understand the implications; use ioBroker Admin/CLI instead.

**Do not use `iobroker install yandex-ud-bridge` until the adapter has been approved into the ioBroker adapter repository.** npm publishing and repository inclusion are separate steps.

## Configure

1. Create a new adapter instance and open its settings in ioBroker Admin.
2. Configure the listen address/port and public HTTPS URL for your reverse proxy.
3. Configure your own OAuth client and account, using the built-in setup UI.
4. In Yandex Dialogs, configure your Smart Home provider API endpoint and OAuth redirect settings. The public endpoint prefix is `/provider/v1.0/`.
5. In the ioBroker Admin side tab **Yandex Smart Home**, add devices, select their state IDs, and set per-capability transformations.
6. Test authorization, discovery, state reads and commands before relying on the devices.

### Typed value mapping

For a gate controlled by `position` where `100 = open` and `0 = closed`, configure a two-way mapping without handwritten JSON:

| Yandex on/off | ioBroker `position` |
|---|---:|
| `true` | `100` |
| `false` | `0` |

Configure the reverse mapping too (or a suitable numeric threshold) for state reads. The adapter auto-detects numeric values typed in the editor. Actual device semantics vary; check your adapter's state before using these values.

### Online / availability

Each device can use an availability state, optionally inverted, or **Always online**. Always online bypasses availability checks; it does **not** guarantee the physical device will execute commands.

### Diagnostics

Enable the detailed action trace to log the received Yandex action, selected ioBroker state, transformed value and write result. An acknowledged ioBroker write does not prove that physical movement occurred.

### Backup and restore

The adapter settings include a **full backup / restore** action, including adapter-native settings, device mappings and OAuth token storage. The export contains sensitive credentials and must be treated like a password database. Do not upload backup files to GitHub Issues or attach them to public bug reports.

Backups do not capture other adapters, VIS scripts, Yandex Dialogs settings, reverse-proxy certificates, or referenced ioBroker state objects. Restoring across servers may therefore require additional setup.

## Developer commands

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

The adapter source is plain JavaScript and does not require a build step. The CI workflow validates syntax, runs tests and checks the npm package file list.

## Publish status

- GitHub source: prepared for publishing; replace the `OWNER` placeholder before creating a public release.
- npm: not published by this bundle.
- ioBroker Latest/Beta/Stable repository: not listed by this bundle.
- Current release: v0.3.16 (pilot version; existing users should test updates on a separate instance).

## License

MIT; see [LICENSE](LICENSE). Ensure copyright ownership and contributor attribution are accurate before first public release.
