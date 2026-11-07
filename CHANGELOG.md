# Changelog

## 0.3.26

- Translate adapter metadata, all published release notes and the JSON Config settings screen into all 11 ioBroker languages.
- Use stable JSON Config translation keys with Weblate-compatible `admin/i18n/<language>/translations.json` files.
- Preserve existing settings, OAuth credentials and device bindings; the standalone device editor retains its existing Russian-language UI pending separate translation work.

## 0.3.25

- Add an explicit pressure-unit preset UI for float pressure properties.
- Support hPa, Pa, kPa, bar, mmHg, atm input and Yandex-approved Pa, bar, mmHg, atm output.
- Generate the existing scale read transform and unit metadata only after clicking Apply; preserve existing manual transforms until then.
- Add conversion, recognition and editor regression tests.

## 0.3.24

- Fix native ioBroker state picker disappearing after clicking Select: legacy footer detector could hide the entire adapter document when Save and Cancel became visible.
- Restrict legacy footer suppression to parent Admin documents and compact action bars, never the editor or modal itself.
- Restore hidden Admin footer reliably on tab close; add regression tests for the picker and standalone tab.
- No changes to device IDs, settings or OAuth configuration.

## 0.3.23

- Require Node.js 22.19+, js-controller 6.0.11+ and Admin 7.6.20+ for upcoming ioBroker catalog compliance.
- Move Admin from same-host dependency to global dependency and update adapter-core/testing.
- Test supported Node.js 22 and 24 runners in CI. No changes to persisted native settings.

## 0.3.22

- Harden OAuth login throttling behind opt-in trusted local Nginx proxy via `X-Real-IP`.
- Keep forwarded headers untrusted by default and reject remote/non-IP proxy headers.
- Bound OAuth login failure buckets and pending authorization request count.
- Add security regression tests and an advisory repository-checker CI job.

## 0.3.21

- Added official ioBroker package-file and js-controller integration test suites.
- Added dedicated CI jobs to run package and integration tests, separate from the fast unit-test matrix.
- Documented OAuth and HTTP security review findings and publication gates.
- No changes to device protocol, OAuth credentials or saved user configuration.

## 0.3.18 — Modern Admin sidebar and standard network settings

- Replaced legacy Materialize/FancyTree state selection with an accessible HTML tree/search dialog.
- Changed the device management sidebar to `adminUI.tab = html` while preserving all existing UI features.
- Standardized HTTP listener options to `bind` and `port` with automatic migration of earlier custom settings.
- Added backward-compatible restore of full backups created with `listenHost` and `listenPort`.
- Expanded compatibility tests, without changing device IDs, mappings, or OAuth token storage.

## 0.3.17 — Admin JSON Config

- Modern JSON Config instance settings for server, OAuth, callbacks and action tracing.
- Keep the existing device editor, state selector and bidirectional mapping UI in the dedicated Admin tab.
- Expose full adapter backup/restore and legacy device import from the Admin tab.
- OAuth credential generation buttons moved into JSON Config; no automatic credential rotation.
- Existing configuration field names, device bindings and token files are preserved.

## 0.3.16 — First public release

- Self-hosted Yandex Smart Home provider API and OAuth 2.0 authorization.
- Device management and ioBroker state bindings, including bidirectional typed value mappings.
- Availability controls, optional "Always online" status and action tracing.
- Adapter settings and OAuth token backup/restore.
- Optional camera integration via externally hosted HTTPS HLS stream URLs.

