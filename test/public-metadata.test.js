'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const load = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('public npm package metadata and version are consistent', () => {
  const pkg = load('package.json');
  const io = load('io-package.json');
  assert.equal(pkg.name, 'iobroker.yandex-ud-bridge');
  assert.equal(pkg.version, io.common.version);
  assert.equal(io.version, pkg.version);
  assert.equal(pkg.author, 'Sergey Batayshchikov');
  assert.equal(io.common.authors[0], 'Sergey Batayshchikov');
  assert.equal(pkg.license, 'MIT');
  assert.equal(io.common.license, undefined, 'Do not set common.license together with common.licenseInformation');
  assert.equal(io.common.licenseInformation?.type, 'free');
  assert.equal(io.common.licenseInformation?.license, pkg.license);
  assert.match(pkg.repository.url, /mastergt\/ioBroker\.yandex-ud-bridge/);
  assert.match(pkg.homepage, /mastergt\/ioBroker\.yandex-ud-bridge/);
  assert.ok(pkg.bugs.url.includes('mastergt/ioBroker.yandex-ud-bridge'));
  assert.ok(pkg.files.includes('admin/'));
  assert.ok(pkg.files.includes('README.ru.md'));
  assert.ok(io.common.icon);
  assert.ok(fs.existsSync(path.join(root, 'admin', io.common.icon)));
  assert.ok(io.common.extIcon.includes('mastergt/ioBroker.yandex-ud-bridge'));
  assert.ok(io.common.readme.includes('mastergt/ioBroker.yandex-ud-bridge'));
});

test('only public release history is included in ioBroker metadata', () => {
  const io = load('io-package.json');
  assert.deepEqual(Object.keys(io.common.news), [io.common.version, '0.3.20', '0.3.16']);
  for (const f of ['LICENSE','CHANGELOG.md','io-package.json','package.json']) {
    const content = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(content, /Community prototype/i, f);
  }
  assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /Sergey Batayshchikov/);
});
