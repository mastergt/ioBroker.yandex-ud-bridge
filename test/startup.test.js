'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const { LocalOAuth } = require('../lib/oauth');

// Exercise the actual main.js startup using the public adapter-core export shape.
// This catches a mistaken destructuring of `utils` while avoiding a running ioBroker host.
test('onReady uses adapter-core getAbsoluteInstanceDataDir and starts the provider', async t => {
    const instanceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-startup-'));
    t.after(() => fs.rmSync(instanceDir, { recursive: true, force: true }));
    const errors = [];
    let resolvedFor;
    class MockAdapter extends EventEmitter {
        constructor(opts) {
            super();
            assert.equal(opts.name, 'yandex-ud-bridge');
            this.config = { listenHost: '127.0.0.1', listenPort: 8096, oauthClientId:'client',oauthClientSecret:'secret',oauthLogin:'user',oauthPassword:'password',devices: [], bindings: [] };
            this.log = { info() {}, warn() {}, error(e) { errors.push(e); } };
            this.states = [];
            this.replies = [];
            this.enumPatterns = [];
            this.namespace = 'yandex-ud-bridge.0';
            this.instanceNative = {devices:[{id:'light',name:'Test'}],bindings:[],oauthPassword:'SENSITIVE',oauthClientSecret:'ALSO-SENSITIVE'};
        }
        async getForeignObjectAsync(id) {
            assert.equal(id,'system.adapter.yandex-ud-bridge.0');
            return {native:this.instanceNative};
        }
        async extendForeignObjectAsync(id, patch) {
            assert.equal(id,'system.adapter.yandex-ud-bridge.0');
            assert.deepEqual(Object.keys(patch.native).sort(),['bindings','devices']);
            this.instanceNative={...this.instanceNative,...patch.native};
        }
        async updateConfig(native) { this.savedConfig = native; this.config = native; }
        async subscribeForeignStatesAsync() {}
        setState(id, state) { this.states.push([id, state]); }
        async getForeignStateAsync() { return { val: null }; }
        async getForeignObjectsAsync(pattern, type) {
            this.enumPatterns.push([pattern,type]);
            return pattern==='enum.rooms.*'
                ? {'enum.rooms.hall':{type:'enum',common:{name:{en:'Hall',ru:'Hall RU'},members:['zigbee.0.hall']}}}
                : {'enum.functions.light':{type:'enum',common:{name:'Light',members:['zigbee.0.hall.switch']}}};
        }
        sendTo(from, command, response, callback) { this.replies.push([from,command,response,callback]); }
    }
    class FakeBridge {
        constructor() { this.localIndex = new Map(); this.onlineIndex = new Map(); this.devices = new Map(); this.bindings = new Map(); }
    }
    class FakeServer extends EventEmitter {
        listen(port, host, callback) {
            assert.equal(port, 8096);
            assert.equal(host, '127.0.0.1');
            this.listening = true;
            callback();
        }
    }
    const exposed = { Adapter: MockAdapter, getAbsoluteInstanceDataDir(adapter) { resolvedFor = adapter; return instanceDir; } };
    const imports = {
        '@iobroker/adapter-core': exposed,
        './lib/bridge': { Bridge: FakeBridge },
        './lib/oauth': { LocalOAuth },
        './lib/diagnostics': { runOAuthDiagnostic: async () => ({ok:true,steps:[{id:'http',status:'ok',title:'HTTP',message:'OK'}],deviceCount:0}) },
        './lib/server': { createProviderServer: () => new FakeServer() },
        './lib/legacy': { parseLegacy() {}, convertLegacy() {} },
        './lib/categories': require('../lib/categories'),
        './lib/tab-config': require('../lib/tab-config'),
        './lib/config-backup': require('../lib/config-backup'),
        './package.json': require('../package.json')
    };
    const fakeRequire = id => imports[id] || require(id);
    fakeRequire.main = {};
    const module = { exports: {} };
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    vm.runInNewContext(source, { require: fakeRequire, module, setTimeout, clearTimeout, Date, Buffer, console }, { filename: 'main.js' });
    const adapter = module.exports();
    await adapter.onReady();
    assert.equal(resolvedFor, adapter, 'the adapter instance must be passed to adapter-core');
    assert.equal(adapter.oauth.file, path.join(instanceDir, 'oauth-tokens.json'));
    assert.equal(adapter.server.listening, true);
    await adapter.onMessage({command:'categories',callback:'cb-1',from:'admin.0',message:{}});
    assert.deepEqual(adapter.enumPatterns,[['enum.rooms.*','enum'],['enum.functions.*','enum']]);
    assert.equal(adapter.replies[0][2].rooms[0].name,'Hall RU');
    assert.equal(adapter.replies[0][2].functions[0].members[0],'zigbee.0.hall.switch');
    await adapter.onMessage({command:'getTabConfig',callback:'cb-2',from:'admin.0',message:{}});
    const returned=adapter.replies.at(-1)[2];
    assert.equal(returned.oauthPassword,undefined);
    assert.equal(returned.oauthClientSecret,undefined);
    assert.equal(returned.devices[0].id,'light');
    await adapter.onMessage({command:'saveTabConfig',callback:'cb-3',from:'admin.0',message:{
        revision:returned.revision,devices:[{id:'light',name:'Updated'}],bindings:[]
    }});
    assert.equal(adapter.replies.at(-1)[2].ok,true);
    assert.equal(adapter.instanceNative.devices[0].name,'Updated');
    assert.equal(adapter.instanceNative.oauthPassword,'SENSITIVE');
    await adapter.onMessage({command:'saveTabConfig',callback:'cb-4',from:'admin.0',message:{
        revision:returned.revision,devices:[],bindings:[]
    }});
    assert.match(adapter.replies.at(-1)[2].error,/изменена/);
    assert.equal(adapter.instanceNative.devices.length,1);
    await adapter.onMessage({command:'oauthDiagnostic',callback:'cb-diagnostic',from:'admin.0',message:{oauthPassword:'injected'}});
    const diag = adapter.replies.at(-1)[2];
    assert.equal(diag.ok,true);
    assert.equal(diag.oauthPassword,undefined);
    assert.equal(diag.steps[0].status,'ok');
    await adapter.onMessage({command:'fullBackupExport',callback:'cb-backup',from:'admin.0',message:{}});
    const backup=adapter.replies.at(-1)[2];
    assert.equal(backup.native.oauthClientSecret,'secret');
    assert.equal(backup.schemaVersion,1);
    assert.equal(backup.oauthTokens.access instanceof Object,true);
    await adapter.onMessage({command:'fullBackupExport',callback:'cb-unsafe',from:'other.0',message:{}});
    assert.match(adapter.replies.at(-1)[2].error,/только из ioBroker Admin/);
    backup.native.oauthPassword='restored-password';
    await adapter.onMessage({command:'fullBackupRestore',callback:'cb-restore',from:'admin.0',message:{backup}});
    assert.equal(adapter.replies.at(-1)[2].ok,true);
    assert.equal(adapter.savedConfig.oauthPassword,'restored-password');
    assert.deepEqual(adapter.oauth.tokens,backup.oauthTokens);
    // Invalid backup is rejected before touching instance native or OAuth storage.
    await adapter.onMessage({command:'fullBackupRestore',callback:'cb-invalid',from:'admin.0',message:{backup:{...backup,format:'wrong'}}});
    assert.match(adapter.replies.at(-1)[2].error,/резервный архив/);
    assert.equal(adapter.savedConfig.oauthPassword,'restored-password');
    assert.deepEqual(errors, []);
    assert.equal(adapter.states.find(([id]) => id === 'info.connection')[1].val, true);
});
