# Changelog

Changes are listed from io-package.json.

## 0.3.16

Always online option and complete configuration/OAuth backup and restore.

## 0.3.15

Device availability is now configured as a compact property card alongside other functions, retaining old online-state settings.

## 0.3.14

No-JSON transform editor: typed value mapping tables, readable thresholds and ranges, reversible mappings and automatic numeric conversion.

## 0.3.13

Optional Yandex action tracing: HTTP request, binding, conversion, ioBroker state write and result, without OAuth secrets.

## 0.3.12

Stateless gates use split=true; motor command tracing for OPEN/CLOSE/STOP.

## 0.3.11

Unified function binding UI: one primary object, optional feedback object, shared read/write transform controls; backward-compatible with 0.3.10.

## 0.3.10

Fixed scrolling in native ioBroker object selector dialog

## 0.3.9

Merge independent value transforms and Tuya curtain preset with OPEN/CLOSE/STOP gate controls, plus full device search. Tuya percent_control: 0 = open, 100 = closed.

## 0.3.6

Independent read/write value transforms; safe Tuya Curtain preset with separated command, percentage and actual position states.

## 0.3.5

Allow Yandex broker callback on social.yandex.ru in OAuth form CSP redirect chain

## 0.3.4

Allow the OAuth browser redirect to social.yandex.net in form-action CSP to avoid blocked first login

## 0.3.3

Persist pending OAuth authorization requests for 15 minutes across restarts and improve expired-form diagnostics

## 0.3.2

Safe local login password rotation without changing Yandex OAuth client; correct Yandex base Endpoint URL

## 0.3.1

Built-in safe OAuth and provider API diagnostic with test token cleanup

## 0.3.0

One-click OAuth client/account bootstrap and copy-ready Yandex Dialogs HTTPS URLs

## 0.2.7

Fix Admin sidebar tab path to /adapter/yandex-ud-bridge/tab_m.html

## 0.2.6

Separate sidebar device manager and diagnostics; keep OAuth/HTTP/legacy import in instance settings

## 0.2.5

Choose rooms from ioBroker categories and suggest room/function from assigned state or channel

## 0.2.4

Use ioBroker Admin native selectID dialog for object picking

## 0.2.3

Fix adapter-core utility import that prevented startup

## 0.2.2

Fix Admin Materialize sendTo communication and state tree loading with retry/error handling

## 0.2.1

Object tree picker, unified read/write state, optional device online availability and offline callbacks

## 0.2.0

New device-oriented editor, built-in OAuth, local ioBroker states only, safe legacy config.js upload

## 0.1.1

Fixed Admin JSON configuration schema (i18n requirement)

## 0.1.0

First local prototype

