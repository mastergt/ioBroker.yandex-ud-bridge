# ioBroker Yandex Smart Home Bridge

[![CI](https://github.com/mastergt/ioBroker.yandex-ud-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/mastergt/ioBroker.yandex-ud-bridge/actions/workflows/ci.yml)

[Русский](README.ru.md) · [Nginx: adapter](examples/nginx/yandex-ud-bridge.conf.example) · [Nginx: HLS video](examples/nginx/yandex-ud-bridge-video.conf.example) · [Issues](https://github.com/mastergt/ioBroker.yandex-ud-bridge/issues)

**ioBroker Yandex Smart Home Bridge** is an unofficial, self-hosted adapter that connects ioBroker states to **Yandex Smart Home / Alice** via your own Yandex Smart Home provider skill. Expose existing smart-home devices, virtual buttons, lights, sensors, gates, curtains and HLS camera streams without running an external cloud bridge.

**Author:** Sergey Batayshchikov · **First public release:** v0.3.16 · **License:** MIT.

> Independent community project. Not affiliated with, endorsed by, or maintained by Yandex or the ioBroker project. The adapter is not part of the official ioBroker adapter repository unless explicitly announced otherwise.

## How it works

```text
Alice / Home with Alice app
         |
         | HTTPS + OAuth 2.0
         v
Internet -> public DNS -> Nginx (TLS :443)
                            |
                            | HTTP to 127.0.0.1:8096
                            v
                   Yandex UD Bridge (ioBroker)
                            |
                            | ioBroker State reads / writes
                            v
                Zigbee / Tuya / MQTT / scripts / ...
```

The adapter hosts **both** the Yandex provider API and an OAuth 2.0 authorization service. Yandex discovers the devices and capabilities you configure, reads their states and sends commands. The bridge maps these commands to ioBroker states and can transform values in both directions. **No JavaScript or JSON is required** for ordinary value mappings.

The local device state remains under the original ioBroker adapter (Zigbee, Tuya, MQTT, JavaScript, etc.). The bridge does not directly manage device radio protocols, and successful state writes do not guarantee that a physical device has moved.

## Requirements

- **ioBroker** with **js-controller 5+** and **Admin 6+**; **Node.js 20+** (see `package.json`/`io-package.json`). Verify your installation has sufficient resources and up-to-date dependencies.
- Existing working **ioBroker state objects** for the devices to expose.
- A **Yandex account** and a **Yandex Smart Home skill** created in [Yandex Dialogs](https://dialogs.yandex.ru/developer/).
- A **publicly reachable HTTPS endpoint** with a valid trusted TLS certificate, publicly resolvable domain name and inbound TCP **443**. In the simplest configuration this means a **public ("white") IPv4 address** and port-forwarding from your router to Nginx; a static address is helpful but dynamic DNS also works. If your ISP uses **CGNAT** or filters incoming connections, use a public VPS/reverse tunnel or another reliable publicly reachable endpoint instead. A private LAN address alone is insufficient.
- **Nginx** or a similar HTTPS reverse proxy. **Do not expose ioBroker Admin** or the adapter's internal HTTP listener to the Internet.
- Optional for camera streaming: a separate **HTTPS HLS** origin (for example go2rtc or another HLS server). RTSP links cannot be passed to Yandex as HLS.

The Yandex servers (and the OAuth browser flow) must reach your public domain; locally working access alone is not enough.

## Installation from GitHub

Before the adapter is included in official ioBroker repositories, use **ioBroker Admin → Adapters → Install from custom source → GitHub** and enter:

```text
https://github.com/mastergt/ioBroker.yandex-ud-bridge
```

Then create/start an instance of `yandex-ud-bridge` and open its settings. GitHub installation is intended for users who understand the risks of an independently maintained adapter. Prefer a tagged release over a moving branch for reproducible installations. **Make an ioBroker backup first**.

Developers can clone the repository and run `npm install`, `npm run check`, `npm test`. The npm package and the official ioBroker catalog have their own publication/review processes; a GitHub repository alone does not make `iobroker install yandex-ud-bridge` available from the catalog.

## Set up the adapter

1. Open the **yandex-ud-bridge instance settings** in Admin. Leave the HTTP listener at **`127.0.0.1`**, port **`8096`**, if Nginx runs on the same host. When Nginx runs elsewhere, use a private, firewalled connection instead of opening the adapter port publicly.
2. Set the **Public HTTPS URL** to your actual origin, for example `https://smart.example.com` — **no trailing path**.
3. In the built-in **OAuth setup** section, generate the OAuth **Client ID / Client Secret** and a separate login/password for account linking. Save the settings. **Keep the credentials confidential.**
4. Check your DNS records, router forwarding and HTTPS proxy. Test the public endpoint from **outside** your home network:
   ```bash
   curl -I https://smart.example.com/provider/v1.0/
   ```
   A working adapter returns `HTTP 200` for this health-style HEAD request. This is not a substitute for testing authenticated requests.
5. In the **Yandex Smart Home** tab in ioBroker Admin, create devices, choose their type and room, add capabilities/properties and bind them to existing ioBroker state IDs.
6. Where needed, configure a **write mapping** (Yandex → ioBroker) and a **read mapping** (ioBroker → Yandex). Save and test devices.

### Example: a gate controlled by a numeric Zigbee position

If your device uses `position=100` for open and `position=0` for closed, bind `on_off/on` to **the actual position state**, for example `zigbee.0.device.position`:

| Yandex command | ioBroker write | ioBroker read | Yandex state |
|---|---:|---:|---|
| Open (`true`) | `100` (number) | `100` | `true` |
| Close (`false`) | `0` (number) | `0` | `false` |

You can use a threshold for intermediate positions (e.g. `position > 0` = open). The editor automatically converts numeric input such as `0` and `100` to **numbers**, not strings. Your own Zigbee/Tuya device may use different semantics: verify them before operating motors.

### Availability and diagnostics

- **Availability** is a compact device property: bind an `available` state, invert it if needed, or select **Always online** for virtual ioBroker states / devices with unreliable availability indicators. Always online only changes the status reported to Yandex; it cannot make an unreachable physical device react.
- **Debug / action trace** records the received Yandex command, device binding, transformation, destination state, value and write result. Enable only as needed; do not publish unredacted logs.
- **Configuration backup / restore** saves the adapter settings, mappings and local OAuth token store. The downloaded JSON file may contain **plaintext secrets/tokens**; treat it as sensitive. The backup **does not** include other ioBroker adapters, JavaScript scripts, external Nginx/TLS, stream servers or the skill settings in Yandex Dialogs.

## Create and connect a Yandex Smart Home skill

1. Open [Yandex Dialogs](https://dialogs.yandex.ru/developer/) and choose **Create dialog → Smart Home**. Provide a name, description and icon. Select **Private** for personal use (private skills are not automatically available to all Yandex users); public listing is a separate publication/moderation process.
2. In the skill **Settings**, set the **Endpoint URL** to:
   ```text
   https://smart.example.com/provider/
   ```
   This is the **base provider endpoint**, not `/provider/v1.0/`. Yandex sends API calls to paths such as `.../provider/v1.0/user/devices`.
3. In **Account linking** (Связка аккаунтов), enter the values generated by the adapter:

   | Yandex field | Value |
   |---|---|
   | Application / Client ID | Adapter **OAuth Client ID** |
   | Application / Client secret | Adapter **OAuth Client Secret** |
   | Authorization URL | `https://smart.example.com/oauth/authorize` |
   | Access token URL | `https://smart.example.com/oauth/token` |
   | Refresh token URL | `https://smart.example.com/oauth/token` |

   These are **your own adapter's OAuth credentials**, not the OAuth application keys of a separate Yandex ID app. The OAuth redirect back to Yandex is handled by the adapter; its allowed redirect is `https://social.yandex.net/broker/redirect`. Do not configure your own redirect URL in the skill.
4. Save the skill, use its **testing/publishing** flow, then open **Home with Alice** and link the skill/account. When prompted for login, enter the **local OAuth login/password generated inside the adapter**, not the Client ID/Secret or your Yandex password.
5. Refresh the devices in Yandex. Verify device discovery, read-state, actions, and offline behavior. You can use the adapter's built-in OAuth/provider diagnostics and debug logs when troubleshooting.

For the current official Yandex UI and field descriptions, see [Skill settings](https://yandex.ru/dev/dialogs/smart-home/doc/ru/start), [Account linking](https://yandex.ru/dev/dialogs/smart-home/doc/ru/auth/add-skill-to-console) and [OAuth flow](https://yandex.ru/dev/dialogs/smart-home/doc/ru/auth/how-it-works). The console UI may change.

## Nginx: HTTPS reverse proxy

Example file: **[`examples/nginx/yandex-ud-bridge.conf.example`](examples/nginx/yandex-ud-bridge.conf.example)**. Use **your own domain and TLS certificate paths**. The example forwards the entire dedicated domain to `127.0.0.1:8096` so both `/oauth/...` and `/provider/...` remain accessible with their original paths.

```nginx
server {
    listen 443 ssl;
    server_name smart.example.com;
    ssl_certificate /etc/letsencrypt/live/smart.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/smart.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8096;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
```

The file also contains an HTTP→HTTPS redirect. Obtain and renew a valid certificate (for example, using Certbot) before enabling the TLS server. Validate with `nginx -t` and reload Nginx. **Do not publish port 8096**; only 443 must be reachable from the Internet.

## Cameras: separate HLS reverse proxy (optional)

For `devices.capabilities.video_stream`, configure a **public HTTPS HLS playlist URL** for the camera. The adapter **returns this URL to Yandex**; it does **not** transcode video or proxy the HLS segments. You can publish a separate HLS endpoint on another domain, for example `video.example.com`.

- Example: **[`examples/nginx/yandex-ud-bridge-video.conf.example`](examples/nginx/yandex-ud-bridge-video.conf.example)** using local go2rtc at `127.0.0.1:1984` with a stream named `camera1`.
- Example playlist: `https://video.example.com/api/stream.m3u8?src=camera1` (source encoding must be H.264).
- Yandex requires **HLS**, H.264 video, at most **1920×1080**, and optional **AAC** audio; the playlist should be served with `Content-Type: application/vnd.apple.mpegurl` and `Access-Control-Allow-Origin: https://yastatic.net`. Segment URLs must also work through HTTPS. See [Yandex video_stream specification](https://yandex.ru/dev/dialogs/smart-home/doc/ru/concepts/video_stream).
- **Security warning:** the sample Nginx configuration is a connectivity example, **not an authenticated streaming gateway**. Anyone with the public playlist link could potentially view the camera. For real deployments, add short-lived signed URLs or another access-control scheme compatible with Yandex playback, and do not expose the go2rtc web UI or arbitrary internal camera streams.

## Troubleshooting

| Symptom | Check |
|---|---|
| Skill cannot connect | Public DNS, public IP/CGNAT, TCP 443, TLS chain, Nginx, `/provider/v1.0/` |
| OAuth link fails | Client ID/Secret, authorization/token URLs, local OAuth login, redirect flow |
| Device missing | Device enabled/visible, capability binding, refresh devices in Yandex |
| Wrong state or motor does not react | Read/write state ID, value type (`0` vs `"0"`), mapping, `ack=false` and physical device logs |
| Camera does not play | HLS (not RTSP), HTTPS playlist/segments, H.264/AAC, response headers and public access |
| Device incorrectly offline | Availability binding, inversion or **Always online** |

### Migrating devices from another skill (for example, yandex2mqtt)

If devices were **previously added to Home with Alice through a different skill** (such as `yandex2mqtt`), simply switching to Yandex UD Bridge may not work, particularly if you keep the same device IDs.

**Observed in practice:** Yandex appears to retain an association between a device ID and the provider skill that originally exposed it. When switching skills, reusing old IDs may interfere with device discovery or control. This is a migration observation, **not a confirmed universal Yandex rule**.

If devices fail to appear or respond after the switch:

1. Disable the old integration and, if necessary, unlink its skill and remove the corresponding devices from Home with Alice.
2. Assign **new, unique device IDs** in Yandex UD Bridge (display names can stay the same).
3. Link the new skill and rediscover/refresh devices in Yandex.

**Important:** removing and re-adding devices may require reconfiguring rooms, scenes and automations. If the migration already works, there is no need to change device IDs.

Never paste authorization tokens, backup JSON, private credentials or complete OAuth URLs with secrets into public Issues. Use [GitHub Issues](https://github.com/mastergt/ioBroker.yandex-ud-bridge/issues) for sanitized problems and [SECURITY.md](SECURITY.md) for sensitive reports.

## Development, contributing and license

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Public releases: [CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE).

**Author and project maintainer:** Sergey Batayshchikov (GitHub: [@mastergt](https://github.com/mastergt)).

## Reverse proxy security

When using Nginx on the same host, keep the adapter listener on `127.0.0.1`.
For per-client OAuth login limits, enable **Trust local Nginx X-Real-IP** only when
Nginx overwrites the `X-Real-IP` header with `$remote_addr`. The setting is
disabled by default. See the [Nginx configuration example](examples/nginx/yandex-ud-bridge.conf.example)
for an additional rate limiter on OAuth endpoints.

## Changelog

### 0.3.23

- Update platform requirements to Node.js 22.19+, js-controller 6.0.11+ and Admin 7.6.20+.
- Upgrade ioBroker testing dependencies and support Node.js 22/24 in CI. See [compatibility notes](docs/COMPATIBILITY.md).

### 0.3.22

- Security hardening for OAuth behind a trusted local Nginx reverse proxy.
- Per-client failed-login throttling, bounded OAuth request tracking and additional security tests.

### 0.3.16 — First public release

- Yandex Smart Home OAuth bridge, device bindings, typed mappings, diagnostics and backup/restore.

Earlier internal development history is intentionally omitted.

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 Sergey Batayshchikov <mastergt@mail.ru>.
