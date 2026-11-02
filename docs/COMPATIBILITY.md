# Runtime compatibility for v0.3.23

**Before updating a running ioBroker installation**, ensure that the target host meets the minimum versions:

| Component | Minimum | Why |
| --- | --- | --- |
| Node.js | 22.19.0 | Supported runtime and current testing requirements |
| ioBroker js-controller | 6.0.11 | ioBroker Repository Checker minimum |
| ioBroker Admin | 7.6.17 | JSON Config and Repository Checker global dependency |

Check the **ioBroker host** (not your workstation):

```bash
node --version
iobroker version
iobroker list adapters | grep -i admin
```

If a minimum is not met, **do not install v0.3.23 yet**. Keep the working v0.3.22 and upgrade the core platform separately, with a backup and a maintenance window. Updating an adapter does not automatically upgrade Node.js, js-controller or Admin.

v0.3.23 does not change persisted devices, bindings, OAuth tokens, HTTP port or other credentials. After upgrading the platform, test authorization, API actions and device state updates.

CI covers Node.js 22 and 24. The integration job uses current `@iobroker/testing` and runs a controller in an isolated environment.
