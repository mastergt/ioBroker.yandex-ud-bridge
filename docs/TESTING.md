# Testing before ioBroker repository submission

## Fast local checks

```bash
npm install
npm run check
npm run test:unit
npm pack --dry-run
```

## Official ioBroker package and integration checks

The project uses the official `@iobroker/testing` harness through Mocha:

```bash
npm run test:package
npm run test:integration
```

`test:package` runs ioBroker package-file validation.
`test:integration` downloads/installs a temporary js-controller test instance, starts the real adapter, probes the local provider health route, and checks that unauthenticated device reads/actions are rejected with HTTP 401. The harness is responsible for cleaning up the adapter environment after the test suite. It runs with the adapter's default `127.0.0.1:8096` listener, so keep that port free on the test host.

The GitHub Actions workflow runs unit tests on Node 20, 22 and 24 and executes the package/integration checks on Node 22. This is intentionally not run in a production ioBroker instance.

## Before npm publication

- Confirm all three GitHub Actions jobs are green on the exact release commit.
- Run [ioBroker Adapter Checker](https://adapter-check.iobroker.in/) for `https://github.com/mastergt/ioBroker.yandex-ud-bridge` on that branch.
- Test actual Admin UI, `bind`/`port` migration and backup restore in a separate ioBroker installation.
- Verify compact-mode start / stop / restart, including cleanup of callback timers and network requests.
- Complete [security review](SECURITY_REVIEW.md).

**Warning:** Passing unit tests or `npm pack --dry-run` is not equivalent to passing real js-controller integration tests or Adapter Checker.
