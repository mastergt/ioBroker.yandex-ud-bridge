# Admin migration — v0.3.18

Version **0.3.18** uses native **JSON Config** for instance settings and a **standalone HTML** device editor in the ioBroker Admin sidebar. The active sidebar no longer loads Materialize, FancyTree, jQuery UI or the old selectID component. The small jQuery bootstrap file is retained solely for ioBroker Admin socket compatibility, not for the editor itself.

## What changes for users

- Device editor, search, rooms, mappings, diagnostics, config import and backup stay in the dedicated sidebar tab.
- Clicking **Select…** opens a built-in accessible HTML dialog, with hierarchical folders and full-text search by state ID, name and role. Large results are capped in the DOM; use search to find a specific state.
- Configuration settings use standard ioBroker `native.bind` and `native.port` instead of `listenHost` / `listenPort`.
- On first startup after upgrading from v0.3.17 or older, saved `listenHost` and `listenPort` values are automatically copied into `bind` and `port`, preserving custom non-default listener addresses and ports. The old fields are marked empty so they do not override subsequent edits. The migration extends only network fields; **OAuth credentials, devices, bindings, token files, and state IDs are not replaced**.
- Backups from v0.3.17 and earlier containing `listenHost` / `listenPort` are accepted; restore converts them to `bind` / `port`. v0.3.18 backs up the current configuration.

## Upgrade checklist

1. Export a **full adapter backup** from the running old version and store it securely; it contains OAuth credentials and tokens.
2. Install v0.3.18 and reload ioBroker Admin (`Ctrl+Shift+R`).
3. Check instance settings -> **Server & HTTPS**: the bind address and port should match your previous setup.
4. Verify HTTP / provider health, OAuth login, device list, state lookup and one actual device command in Alice.
5. Verify backup export/import on a separate test instance before doing any restore on the running instance.
6. If your Admin sidebar no longer starts, check the browser developer console and adapter logs; roll back to v0.3.17 with your backup as needed.

## Known limits before official ioBroker catalog application

- ioBroker community reviewers should explicitly approve the optional custom Admin sidebar tab; the standard instance settings already use JSON Config.
- Full ioBroker package/install/integration tests are still required, including compact mode and a complete OAuth/network security review.
- Automated tests cannot fully validate a real Admin browser session. A live Admin 6+/7+ upgrade test is recommended.

## Русское резюме

В **0.3.18** настройки экземпляра остаются JSON Config, а боковая вкладка управления устройствами работает без Materialize и FancyTree. Выбор объектов сделан через собственное модальное окно с деревом и поиском. Поля сервера переименованы в стандартные **`bind`** и **`port`**, старые значения **`listenHost`** / **`listenPort`** переносятся автоматически при запуске. Маппинги, устройства и OAuth-токены не изменяются. Перед обновлением сохраните полный бэкап и проверьте HTTPS, привязку навыка и управление устройствами.
