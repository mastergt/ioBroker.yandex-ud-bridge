'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {effectiveNetworkConfig, needsMigration, migrationPatch, migrateBackupNative} = require('../lib/network-config');
const { exportSnapshot, validateSnapshot } = require('../lib/config-backup');
const io = require('../io-package.json');
const config = {devices:[{id:'light',name:'Light'}],bindings:[],oauthClientId:'client',oauthClientSecret:'KEEP',oauthLogin:'home',oauthPassword:'SECRET',callbackOauthToken:'DO-NOT-TOUCH'};
const tokens = {access:{},refresh:{}};
test('new instance binds to private loopback and standard HTTP port',()=>{
  assert.deepEqual(effectiveNetworkConfig(io.native),{bind:'127.0.0.1',port:8096});
  assert.ok('bind' in io.native);
  assert.ok('port' in io.native);
  assert.ok(!('listenHost' in io.native));
  assert.ok(!('listenPort' in io.native));
});
test('legacy non-default bind and port beat injected new defaults during first upgrade',()=>{
  const legacy={bind:'127.0.0.1',port:8096,listenHost:'192.0.2.11',listenPort:10096,...config};
  assert.deepEqual(effectiveNetworkConfig(legacy),{bind:'192.0.2.11',port:10096});
  assert.deepEqual(migrationPatch(legacy),{bind:'192.0.2.11',port:10096,listenHost:'',listenPort:0});
  assert.equal(needsMigration(legacy),true);
  const migrated={...legacy,...migrationPatch(legacy)};
  assert.equal(needsMigration(migrated),false);
  assert.deepEqual(effectiveNetworkConfig({...migrated,port:8096,bind:'127.0.0.1'}),{bind:'127.0.0.1',port:8096});
  assert.equal(migrated.oauthClientSecret,'KEEP');
  assert.deepEqual(migrated.devices,config.devices);
});
test('new settings win over tombstoned legacy defaults',()=>{
  assert.deepEqual(effectiveNetworkConfig({bind:'::1',port:10000,listenHost:'',listenPort:0}),{bind:'::1',port:10000});
  assert.equal(needsMigration({bind:'::1',port:10000,listenHost:'',listenPort:0}),false);
});
test('0.3.17 backup restores devices, credentials and maps old network fields into new ones',()=>{
  const old={...config,listenHost:'192.0.2.11',listenPort:10096};
  const snapshot=exportSnapshot(old,tokens,'yandex-ud-bridge.0','0.3.17');
  const restored=validateSnapshot(snapshot).native;
  assert.equal(restored.port,10096);
  assert.equal(restored.bind,'192.0.2.11');
  assert.equal(restored.listenHost,undefined);
  assert.equal(restored.listenPort,undefined);
  assert.deepEqual(restored.devices,old.devices);
  assert.deepEqual(restored.bindings,old.bindings);
  assert.equal(restored.oauthClientSecret,'KEEP');
  assert.deepEqual(migrateBackupNative(restored),restored);
});
test('new backup preserves custom bind/port and rejects illegal ports',()=>{
  const native={...config,bind:'127.0.0.1',port:10097};
  assert.deepEqual(validateSnapshot(exportSnapshot(native,tokens,'yandex-ud-bridge.0','0.3.18')).native,native);
  assert.throws(()=>validateSnapshot(exportSnapshot({...native,port:70000},tokens,'yandex-ud-bridge.0','0.3.18')),/Неверный порт/);
});
