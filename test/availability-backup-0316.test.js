'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Bridge } = require('../lib/bridge');
const { exportSnapshot, validateSnapshot } = require('../lib/config-backup');

const config = {
    listenHost:'127.0.0.1',listenPort:8096,
    oauthClientId:'id',oauthClientSecret:'secret-from-runtime',oauthLogin:'user',oauthPassword:'password-from-runtime',
    oauthUserId:'1',callbackOauthToken:'callbacktoken',
    devices:[{id:'virtual',name:'VIS',enabled:true,onlineStateId:'tuya.0.x.available',onlineEnabled:true,onlineAlways:true}],
    bindings:[{deviceId:'virtual',kind:'capability',type:'on_off',instance:'on',enabled:true,
        stateId:'javascript.0.test.virtual',retrievable:true,
        writeTransform:JSON.stringify({type:'lookup',pairs:[[true,100],[false,0]]}),
        readTransform:JSON.stringify({type:'lookup',pairs:[[100,true],[0,false]]})}]
};
const tokens={ access: {['a'.repeat(64)]:{user:'1',expires:1893456000000}}, refresh:{['b'.repeat(64)]:{user:'1',expires:1893456000000,client:'id'}}};

test('always online overrides a real offline state without subscribe or status callbacks', async () => {
    let touched=[];
    const bridge=new Bridge(config,{
        getState: async id => {touched.push(id);return id.includes('available') ? false : 0;},
        setState: async()=>{}
    },{warn(){},info(){}});
    assert.deepEqual([...bridge.onlineIndex.keys()],[]);
    const result=await bridge.query('1',[{id:'virtual'}]);
    assert.equal(result[0].error_code,undefined);
    assert.equal(result[0].capabilities[0].state.value,false);
    assert.equal(touched.includes('tuya.0.x.available'),false);
    assert.equal(bridge.discover('1')[0].status_info.reportable,false);
    assert.deepEqual(await bridge.onStateChange('tuya.0.x.available',false),[]);
});

test('old disabled/legacy availability and force-online precedence', async () => {
    const values=[
        {d:{onlineEnabled:false, onlineAlways:true}, online:true},
        {d:{onlineEnabled:true, onlineAlways:true}, online:true},
        {d:{onlineEnabled:true, onlineAlways:false}, online:false},
        {d:{onlineEnabled:undefined, onlineAlways:undefined}, online:false}
    ];
    for(const {d,online} of values){
        const bridge=new Bridge({...config,devices:[{...config.devices[0],...d}]}, {getState:async()=>false,setState:async()=>{}},{warn(){}});
        assert.equal(await bridge.deviceOnline([...bridge.devices.values()][0]),online);
    }
});

test('full export includes native secrets, 2-way mapping, and existing token hashes', () => {
    const snapshot=exportSnapshot(config,tokens,'yandex-ud-bridge.0','0.3.16');
    assert.equal(snapshot.format,'iobroker.yandex-ud-bridge.full-backup');
    assert.equal(snapshot.native.oauthPassword,'password-from-runtime');
    assert.deepEqual(validateSnapshot(JSON.parse(JSON.stringify(snapshot))).native,config);
    assert.deepEqual(validateSnapshot(snapshot).oauthTokens,tokens);
});

test('backup rejects corrupt, incomplete, and untrusted snapshots', () => {
    const original=exportSnapshot(config,tokens,'yandex-ud-bridge.0','0.3.16');
    const check=x=>assert.throws(()=>validateSnapshot(x));
    check({});
    check({...original,format:'incorrect'});
    check({...original,oauthTokens:{access: {},refresh:{broken:{}}}});
    check({...original,native:{...config,oauthClientSecret:undefined}});
    check({...original,native:{...config,bindings:[{...config.bindings[0],deviceId:'missing'}]}});
    check({...original,native:{...config,listenPort:70000}});
    const m=JSON.parse(JSON.stringify(original)); m.native.__proto__='zzz';
    const withPollution=JSON.parse(JSON.stringify(original));
    Object.defineProperty(withPollution.native,'__proto__',{value:'bad',enumerable:true});
    check(withPollution);
    assert.equal(Object.prototype.polluted,undefined);
});

test('Admin backup UI and availability override are present',()=>{
    const html=fs.readFileSync(path.join(__dirname,'../admin/index_m.html'),'utf8');
    const js=fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8');
    assert.match(html,/data-view="backup"/);
    assert.match(html,/id="backup-file"/);
    assert.match(js,/Всегда доступен/);
    assert.match(js,/fullBackupExport/);
    assert.match(js,/fullBackupRestore/);
});
