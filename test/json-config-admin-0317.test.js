'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const io = require('../io-package.json');
const pkg = require('../package.json');
const schema = require('../admin/jsonConfig.json');
const visibleInputs = new Set(['bind','port','publicBaseUrl','oauthClientId','oauthClientSecret','oauthLogin','oauthPassword','oauthUserId','callbackEnabled','callbackSkillId','callbackOauthToken','debugActions']);

test('Admin 3 JSON configuration has all supported instance settings and protects secrets', () => {
  assert.equal(io.common.adminUI.config, 'json');
  assert.equal(schema.type, 'tabs');
  const fields = [];
  for (const tab of Object.values(schema.items)) {
    assert.equal(tab.type, 'panel');
    for (const [name, definition] of Object.entries(tab.items)) {
      assert.equal(typeof definition.type, 'string');
      if (!name.startsWith('_')) {
        fields.push(name);
        assert.ok(name in io.native, `jsonConfig field ${name} must be in io-package.native`);
      }
    }
  }
  assert.deepEqual(new Set(fields), visibleInputs);
  for (const field of ['oauthClientSecret','oauthPassword','callbackOauthToken']) {
    assert.equal(schema.items.oauth.items[field]?.type === 'password' || schema.items.callbacks.items[field]?.type === 'password',true);
    assert.ok(io.encryptedNative.includes(field));
    assert.ok(io.protectedNative.includes(field));
  }
  assert.equal(schema.items.oauth.items._createOAuth.command, 'jsonOAuthBootstrap');
  assert.equal(schema.items.oauth.items._createOAuth.useNative, true);
  assert.equal(schema.items.oauth.items._rotateLogin.command, 'jsonOAuthRotatePassword');
  assert.equal(schema.items.oauth.items._rotateLogin.useNative, true);
  assert.equal(pkg.version, io.version);
  assert.equal(pkg.version, io.common.version);
});

test('legacy device editor, data models, and backup controls remain installed', () => {
  const tab = fs.readFileSync(path.join(root, 'admin/tab_m.html'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'admin/editor.js'), 'utf8');
  assert.match(tab, /data-view="devices"/);
  assert.match(tab, /data-view="diagnostic"/);
  assert.match(tab, /data-view="backup"/);
  assert.match(tab, /id="backup-file"/);
  assert.match(tab, /data-view="migration"/);
  assert.match(editor, /fullBackupExport/);
  assert.match(editor, /fullBackupRestore/);
  assert.doesNotMatch(editor, /if \(bridgeMode !== 'settings'\) return;\s*send\('fullBackupExport'/);
  assert.doesNotMatch(editor, /if \(bridgeMode !== 'settings'\) return;\s*document\.querySelector\('#backup-file'/);
  assert.match(editor, /bridgeMode==='settings'\?'/);
  assert.ok(Array.isArray(io.native.devices) && Array.isArray(io.native.bindings));
  assert.equal(io.native.bind, '127.0.0.1');
  assert.equal(io.native.port, 8096);
});
