'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LocalOAuth } = require('../lib/oauth');
const { parseLegacy, convertLegacy } = require('../lib/legacy');
const { Bridge } = require('../lib/bridge');
const { createProviderServer } = require('../lib/server');
const config = { oauthClientId: 'yandex-app', oauthClientSecret: 'test-secret', oauthLogin:'admin', oauthPassword:'test-pass', oauthUserId:'2' };
function oauth(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new LocalOAuth(config,dir);}
function grant(o) {
    const nonce=o.authRequest({client_id:'yandex-app',response_type:'code',redirect_uri:'https://social.yandex.net/broker/redirect',state:'opaque',scope:'smarthome'});
    const login=o.login({nonce,username:'admin',password:'test-pass'});
    assert.ok(login.location);return new URL(login.location).searchParams.get('code');
}
test('legacy config literal-only parser rejects code execution',()=>{
    assert.throws(()=>parseLegacy('module.exports = process.exit(1)'),/Недопустимое выражение/);
    assert.throws(()=>parseLegacy('module.exports = {}; console.log(1)'),/Лишний/);
    assert.throws(()=>parseLegacy('module.exports = {devices: require("/etc/passwd")}'),/Недопустимое/);
    assert.deepEqual(parseLegacy("module.exports={ devices:[{id:'abc', enabled:true}], mqtt:{password:'hidden'}};").devices,[{id:'abc',enabled:true}]);
});
test('imports actual legacy file preserving all devices but no credentials or MQTT',()=>{
    const archive='/mnt/data/yandex2mqtt.zip';
    if(!fs.existsSync(archive))return;
    const old=execFileSync('unzip',['-p',archive,'yandex2mqtt/config.js'],{maxBuffer:2e6}).toString();
    const result=convertLegacy(parseLegacy(old));
    assert.equal(result.devices.length,30);assert.equal(result.bindings.length,46);
    assert.equal(result.bindings.filter(b=>b.enabled).length, result.bindings.filter(b=>b.type==='video_stream').length);
    assert.equal(result.devices[0].id,'window-bedroom-sensor');
    assert.equal(JSON.stringify(result).includes('privateKey'),false);
    assert.equal(JSON.stringify(result).includes('mqttPassword'),false);
    assert.equal(JSON.stringify(result).includes('clientSecret'),false);
});
test('OAuth code exchange, validation, refresh rotation and revoke',t=>{
    const o=oauth(t),code=grant(o);
    const first=o.tokenRequest({grant_type:'authorization_code',code,redirect_uri:'https://social.yandex.net/broker/redirect'},{id:'yandex-app',secret:'test-secret'});
    assert.equal(first.status,200);assert.equal(o.validate(first.body.access_token),'2');
    assert.equal(o.tokenRequest({grant_type:'authorization_code',code,redirect_uri:'https://social.yandex.net/broker/redirect'},{id:'yandex-app',secret:'test-secret'}).status,400);
    const second=o.tokenRequest({grant_type:'refresh_token',refresh_token:first.body.refresh_token},{id:'yandex-app',secret:'test-secret'});
    assert.equal(second.status,200);assert.equal(o.validate(second.body.access_token),'2');
    assert.equal(o.tokenRequest({grant_type:'refresh_token',refresh_token:first.body.refresh_token},{id:'yandex-app',secret:'test-secret'}).status,400);
    const persisted=fs.readFileSync(o.file,'utf8');assert.equal(persisted.includes(first.body.access_token),false);
    assert.equal(persisted.includes(second.body.refresh_token),false);
    const o2=new LocalOAuth(config,path.dirname(o.file));assert.equal(o2.validate(second.body.access_token),'2');
    o2.unlink('2');assert.equal(o2.validate(second.body.access_token),null);
});
test('OAuth blocks untrusted redirect and bad client secret',t=>{
    const o=oauth(t);
    assert.throws(()=>o.authRequest({client_id:'yandex-app',response_type:'code',redirect_uri:'https://attacker.test/a'}),/Unapproved/);
    assert.throws(()=>o.authRequest({client_id:'other',response_type:'code',redirect_uri:'https://social.yandex.net/broker/redirect'}),/Invalid OAuth/);
    const code=grant(o);
    assert.equal(o.tokenRequest({grant_type:'authorization_code',code,redirect_uri:'https://social.yandex.net/broker/redirect'},{id:'yandex-app',secret:'wrong'}).status,401);
});
function mockBridge(){
    const states=new Map([['light.on',true]]),calls=[];
    const bridge = new Bridge({ oauthUserId:'2', devices:[{id:'desk',name:'Свет',type:'devices.types.light',allowedUsers:'1',enabled:true}], bindings:[{deviceId:'desk',kind:'capability',type:'on_off',instance:'on',backend:'iobroker',stateId:'light.on',commandId:'light.on',enabled:true,retrievable:true}] }, {getState:async id=>states.get(id),setState:async (id,val)=>{states.set(id,val);calls.push([id,val]);}});
    return {bridge,states,calls};
}
test('Bridge handles local State read, write and user access',async()=>{
    const {bridge,states,calls}=mockBridge();
    assert.equal(bridge.discover('2').length,1);assert.equal(bridge.discover('1').length,0);
    const q=await bridge.query('2',[{id:'desk'}]);assert.equal(q[0].capabilities[0].state.value,true);
    const act=await bridge.action('2',[{id:'desk',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]);
    assert.equal(act[0].capabilities[0].state.action_result.status,'DONE');assert.deepEqual(calls,[['light.on',false]]);
    assert.equal(states.get('light.on'),false);
    assert.equal((await bridge.action('1',[{id:'desk'}]))[0].action_result.error_code,'DEVICE_NOT_FOUND');
});
test('HTTP provider and OAuth endpoints conform to query/action flow',async t=>{
    const auth=oauth(t),{bridge}=mockBridge(),server=createProviderServer(bridge,config,{warn:()=>{}},auth);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+'/provider/v1.0/',{method:'HEAD'})).status,200);
    assert.equal((await fetch(base+'/provider/v1.0/user/devices')).status,401);
    const code=grant(auth);
    const issued=auth.tokenRequest({grant_type:'authorization_code',code,redirect_uri:'https://social.yandex.net/broker/redirect'},{id:config.oauthClientId,secret:config.oauthClientSecret}).body;
    const headers={authorization:`Bearer ${issued.access_token}`,'content-type':'application/json'};
    const dev=await fetch(base+'/provider/v1.0/user/devices',{headers});assert.equal(dev.status,200);assert.equal((await dev.json()).payload.devices[0].id,'desk');
    const q=await fetch(base+'/provider/v1.0/user/devices/query',{method:'POST',headers,body:JSON.stringify({devices:[{id:'desk'}]})});assert.equal((await q.json()).payload.devices[0].capabilities[0].state.value,true);
    const a=await fetch(base+'/provider/v1.0/user/devices/action',{method:'POST',headers,body:JSON.stringify({payload:{devices:[{id:'desk',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]}})});assert.equal((await a.json()).payload.devices[0].capabilities[0].state.action_result.status,'DONE');
    const unlink=await fetch(base+'/provider/v1.0/user/unlink',{method:'POST',headers});assert.equal(unlink.status,200);
    assert.equal((await fetch(base+'/provider/v1.0/user/devices',{headers})).status,401);
});
test('boolean ioBroker contact converts to Yandex open/closed events',async()=>{
    const {toYandex}=require('../lib/bridge');
    const b={kind:'property',type:'event',instance:'open',mapping:''};
    assert.equal(toYandex(true,b),'opened');
    assert.equal(toYandex(false,b),'closed');
    assert.equal(toYandex('closed',b),'closed');
});

test('device online state is separate from on_off and gates query/action',async()=>{
    const {isOnline}=require('../lib/bridge');
    assert.equal(isOnline(false),false);
    assert.equal(isOnline('offline'),false);
    assert.equal(isOnline('connected'),true);
    assert.equal(isOnline(1),true);
    assert.equal(isOnline(0,true),true);
    assert.equal(isOnline(undefined),false);
    const states=new Map([['lamp.on',true],['lamp.online',false]]),writes=[];
    const bridge=new Bridge({oauthUserId:'2',devices:[{id:'lamp',name:'Лампа',type:'devices.types.light',enabled:true,onlineStateId:'lamp.online'}],bindings:[
        {deviceId:'lamp',kind:'capability',type:'on_off',instance:'on',stateId:'lamp.on',enabled:true,retrievable:true}
    ]}, {getState:async id=>states.get(id),setState:async (id,value)=>writes.push([id,value])});
    assert.equal(bridge.discover('2')[0].status_info.reportable,false);
    const offQuery=await bridge.query('2',[{id:'lamp'}]);
    assert.equal(offQuery[0].error_code,'DEVICE_UNREACHABLE');
    const offAction=await bridge.action('2',[{id:'lamp',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]);
    assert.equal(offAction[0].action_result.error_code,'DEVICE_UNREACHABLE');
    assert.equal(writes.length,0);
    assert.deepEqual(await bridge.onStateChange('lamp.online',false),[{id:'lamp',status:'offline',capabilities:[],properties:[]}]);
    assert.deepEqual(await bridge.onStateChange('lamp.online',false),[]);
    states.set('lamp.online',true);
    assert.deepEqual(await bridge.onStateChange('lamp.online',true),[{id:'lamp',status:'online',capabilities:[],properties:[]}]);
    assert.equal((await bridge.query('2',[{id:'lamp'}]))[0].capabilities[0].state.value,true);
    assert.equal((await bridge.action('2',[{id:'lamp',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]))[0].capabilities[0].state.action_result.status,'DONE');
    assert.deepEqual(writes,[['lamp.on',false]]);
});
test('availability reporting follows callback configuration',()=>{
    const d={id:'door',name:'Контакт',type:'devices.types.sensor.open',onlineStateId:'zigbee.0.contact.available',enabled:true};
    const b={deviceId:'door',kind:'property',type:'event',instance:'open',stateId:'zigbee.0.contact.open',enabled:true};
    const transport={getState:async()=>true,setState:async()=>{}};
    const a=new Bridge({oauthUserId:'2',devices:[d],bindings:[b],callbackEnabled:true,callbackSkillId:'skill',callbackOauthToken:'token'},transport);
    assert.equal(a.discover('2')[0].status_info.reportable,true);
});


test('legacy allowedUsers cannot hide devices from the one valid OAuth identity', () => {
    const d={id:'switch',name:'Выключатель',enabled:true,allowedUsers:'legacy-id'};
    const b={deviceId:'switch',kind:'capability',type:'on_off',instance:'on',stateId:'switch.state',enabled:true};
    const adapter=new Bridge({oauthUserId:'primary',devices:[d],bindings:[b]}, {getState:async()=>false,setState:async()=>{}});
    assert.equal(adapter.discover('primary').length,1);
    assert.equal(adapter.discover('legacy-id').length,0);
    const disabled=new Bridge({oauthUserId:'primary',devices:[{...d,enabled:false}],bindings:[b]}, {getState:async()=>false,setState:async()=>{}});
    assert.equal(disabled.discover('primary').length,0);
});
