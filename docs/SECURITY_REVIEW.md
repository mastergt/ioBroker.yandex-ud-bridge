# Security review — preparation for ioBroker publication

**Scope:** Yandex UD Bridge v0.3.22, code inspection and automated HTTP/OAuth tests. This is an initial review, not a formal penetration test or a release security guarantee.

## Implemented and tested safeguards

- Public Yandex API requires an OAuth Bearer token for device discovery, query, actions and unlink; unauthenticated requests return HTTP 401.
- OAuth authorization requests are limited to a fixed Yandex redirect URI; a random nonce protects the HTML login flow, with 15-minute expiry and single-use consumption.
- Access and refresh tokens are stored hashed and OAuth credentials are encrypted/protected via ioBroker native configuration.
- HTTP POST bodies are limited to 64 KiB; responses include `no-store` and `nosniff`, login pages include restrictive CSP and frame protection.
- `sendTo` commands which enumerate local ioBroker states, read/change device mappings or run diagnostics are restricted to messages from the ioBroker Admin adapter. Backup and credential-management messages were already restricted.
- Backup exports contain OAuth secrets and token hashes: the downloaded JSON remains sensitive and must not be attached to GitHub issues.

## Follow-up review items before public npm release

1. **Reverse proxy and brute-force protections.** Login throttling is per socket IP by default. In a local Nginx deployment, enable `trustProxy` and configure `proxy_set_header X-Real-IP $remote_addr;`: **only** a loopback connection may supply this header, which must contain one valid IPv4/IPv6 address. Do not enable this setting with an externally accessible HTTP listener or a proxy that forwards untrusted `X-Real-IP`. Nginx should also enforce its own request limits on `/oauth/*`, since a process restart resets in-memory counters.
2. **Input-level abuse protection.** Add integration/load tests for concurrent OAuth grant requests, intentionally slow HTTP connections, and oversized payloads. Node HTTP timeouts and 64 KiB body limit provide initial constraints.
3. **Admin message provenance.** The Admin sender check uses `msg.from` and relies on ioBroker's internal message routing. Verify that ioBroker enforces sender identity and permissions for `sendTo` before considering this a full trust boundary.
4. **REST/authorization regression coverage.** Verify OAuth code exchange, refresh rotation, unlink and callback behavior against a live ioBroker integration environment before public publication.
5. **HTTPS deployment.** Operate the HTTP listener on a local/isolated interface, expose only trusted HTTPS through a reverse proxy, rotate OAuth secrets after accidental disclosure, and keep Nginx and ioBroker security fixes current.
6. **Backup import.** The complete backup restores native settings and hashed tokens. Review request-size/memory limits and ensure restore runs only in a trusted Admin session. Use private secure storage for exports.

## Security report

Report vulnerabilities privately according to [SECURITY.md](../SECURITY.md). Do not post tokens, passwords, private streams or complete backup files in public issues.
