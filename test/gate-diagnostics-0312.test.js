'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Bridge} = require('../lib/bridge');
const state = 'zigbee.0.f84477fffea7942d.state';
const gate = {id:'gate',type:'devices.types.openable',enabled:true};
const binding = {deviceId:'gate',kind:'capability',type:'on_off',instance:'on',enabled:true,commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE',stateId:state,commandId:state};
function makeBridge(retrievable) {
    const writes=[],infos=[],warnings=[];
    const bridge = new Bridge({devices:[gate],bindings:[{...binding,retrievable}]},
        {getState:async()=> 'STOP', setState:async (id,val)=>writes.push([id,val])},
        {info:m=>infos.push(m),warn:m=>warnings.push(m),debug:()=>{}});
    return {bridge,writes,infos,warnings};
}
test('stateless gate uses Yandex split=true and skips state queries',async()=>{
    const {bridge} = makeBridge(false);
    const data = bridge.discover('1')[0].capabilities[0];
    assert.equal(data.retrievable,false);
    assert.deepEqual(data.parameters,{split:true});
    assert.deepEqual(await bridge.query('1',[{id:'gate'}]),[{id:'gate'}]);
});
test('gate action logs intended write and calls the ioBroker state setter with string OPEN',async()=>{
    const {bridge,writes,infos} = makeBridge(false);
    const res=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:true}}]}]);
    assert.equal(res[0].capabilities[0].state.action_result.status,'DONE');
    assert.deepEqual(writes,[[state,'OPEN']]);
    assert.ok(infos.some(x=>x.includes('Yandex motor command:') && x.includes('OPEN')));
    assert.ok(infos.some(x=>x.includes('Yandex motor command submitted:')));
});
test('retrievable mode remains unchanged for gates with actual feedback',()=>{
    const {bridge} = makeBridge(true);
    const data = bridge.discover('1')[0].capabilities[0];
    assert.equal(data.retrievable,true);
    assert.equal(data.parameters,undefined);
});
test('no matching command binding is reported to adapter logs',async()=>{
    const {bridge,warnings}=makeBridge(false);
    const res=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'bad',value:true}}]}]);
    assert.equal(res[0].capabilities[0].state.action_result.error_code,'INVALID_ACTION');
    assert.ok(warnings[0].includes('binding not found'));
});
