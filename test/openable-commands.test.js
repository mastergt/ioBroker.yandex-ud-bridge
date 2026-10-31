'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Bridge, toYandex, fromYandex } = require('../lib/bridge');

const openClose = { deviceId:'gate',kind:'capability',type:'on_off',instance:'on',commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE',commandId:'tuya.0.gate.control',enabled:true,retrievable:false };
const stop = { deviceId:'gate',kind:'capability',type:'toggle',instance:'pause',commandMode:'stop_only',stopValue:'STOP',commandId:'tuya.0.gate.control',enabled:true,retrievable:false };
function makeBridge() {
    const calls=[];
    const bridge=new Bridge({oauthUserId:'1',devices:[{id:'gate',type:'devices.types.openable',name:'Ворота'}],bindings:[openClose,stop]}, { getState:async()=>undefined, setState:async (id,value)=>{calls.push([id,value]);} });
    return {bridge,calls};
}
test('openable type is exposed as supported Yandex device',()=>{
    const {bridge}=makeBridge();
    const devices=bridge.discover('1');
    assert.equal(devices[0].type,'devices.types.openable');
    assert.deepEqual(devices[0].capabilities.map(c=>[c.type,c.retrievable]), [
        ['devices.capabilities.on_off',false],['devices.capabilities.toggle',false]
    ]);
});
test('OPEN/CLOSE enum strings do not lose their case and STOP is not interpreted as closed',()=>{
    assert.equal(fromYandex(true,openClose),'OPEN');
    assert.equal(fromYandex(false,openClose),'CLOSE');
    assert.equal(fromYandex(true,stop),'STOP');
    assert.equal(toYandex('OPEN',openClose),true);
    assert.equal(toYandex('CLOSE',openClose),false);
    assert.equal(toYandex('STOP',openClose),undefined);
    assert.equal(toYandex(null,openClose),undefined);
});
test('OPEN, CLOSE and STOP route to one ioBroker State; false pause rejected',async()=>{
    const {bridge,calls}=makeBridge();
    for (const val of [true,false]) {
        const res=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:val}}]}]);
        assert.equal(res[0].capabilities[0].state.action_result.status,'DONE');
    }
    const res=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.toggle',state:{instance:'pause',value:true}}]}]);
    assert.equal(res[0].capabilities[0].state.action_result.status,'DONE');
    assert.deepEqual(calls,[['tuya.0.gate.control','OPEN'],['tuya.0.gate.control','CLOSE'],['tuya.0.gate.control','STOP']]);
    const invalid=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.toggle',state:{instance:'pause',value:false}}]}]);
    assert.equal(invalid[0].capabilities[0].state.action_result.error_code,'INVALID_VALUE');
    assert.equal(calls.length,3);
});
test('old Boolean and percent bindings still behave exactly as before',()=>{
    const ordinary={type:'on_off'};
    assert.equal(fromYandex(true,ordinary),true);
    assert.equal(toYandex(false,ordinary),false);
    assert.equal(fromYandex(80,{type:'range',instance:'open'}),80);
});
test('admin includes full type/room/name search and gate template',()=>{
    const ui=fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8');
    assert.match(ui,/devices\.types\.openable'\s*:\s*\['Ворота/);
    assert.match(ui,/roomEnumId,room,item\.type,type,item\.description/);
    assert.match(ui,/terms\.every\(term=>text\.includes\(term\)\)/);
    assert.match(ui,/enum_open_close/);
    assert.match(ui,/stop_only/);
});
