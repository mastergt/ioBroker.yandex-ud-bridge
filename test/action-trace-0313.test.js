'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Bridge } = require('../lib/bridge');
const { safeTraceValue } = require('../lib/action-trace');
const { createProviderServer } = require('../lib/server');
const { LocalOAuth } = require('../lib/oauth');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE='zigbee.0.f84477fffea7942d.state';
const BINDING={deviceId:'vorota_garage',kind:'capability',type:'on_off',instance:'on',enabled:true,commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE',commandId:STATE,retrievable:false};
const DEVICE={id:'vorota_garage',enabled:true,type:'devices.types.openable',name:'Гараж'};
const ACTION={id:'vorota_garage',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:true}}]};
function harness(debugActions, setState = async () => {}) {
    const logs={info:[],warn:[]};
    const log={info:x=>logs.info.push(x),warn:x=>logs.warn.push(x),debug:()=>{}};
    const writes=[];
    const config={oauthUserId:'1',debugActions,devices:[DEVICE],bindings:[BINDING]};
    const bridge=new Bridge(config,{getState:async()=>undefined,setState:async(id,value)=>{writes.push([id,value]);return setState(id,value);}},log);
    return {bridge,config,log,logs,writes};
}
test('debug traces incoming Yandex on_off, mapping and final ioBroker write with same request id', async()=>{
    const h=harness(true);
    const out=await h.bridge.action('1',[ACTION],{requestId:'request-001'});
    assert.deepEqual(h.writes,[[STATE,'OPEN']]);
    assert.equal(out[0].capabilities[0].state.action_result.status,'DONE');
    const log=h.logs.info.join('\n');
    for(const marker of ['[YUD TRACE]','req=request-001','device=vorota_garage','RECEIVE','value=true','BINDING','mode=enum_open_close','TRANSFORM input=true output="OPEN"','WRITE setForeignStateAsync state='+STATE,'ack=false','RESULT setForeignStateAsync resolved','physical device operation NOT verified','YANDEX capability=on_off/on result=DONE']){
        assert.ok(log.includes(marker), 'missing: '+marker);
    }
});
test('disabled tracing produces no extended log lines',async()=>{
    const h=harness(false);
    await h.bridge.action('1',[ACTION],{requestId:'request-002'});
    assert.equal(h.logs.info.filter(x=>x.includes('[YUD TRACE]')).length,0);
});
test('failed write is traced as ERROR and returned to Yandex as error, not DONE',async()=>{
    const h=harness(true,async()=>{throw Error('mock transport failure');});
    const out=await h.bridge.action('1',[ACTION],{requestId:'request-003'});
    assert.equal(out[0].capabilities[0].state.action_result.status,'ERROR');
    assert.equal(out[0].capabilities[0].state.action_result.error_code,'INTERNAL_ERROR');
    const log=h.logs.info.join('\n');
    assert.match(log,/ERROR capability=on_off\/on error=mock transport failure/);
    assert.match(log,/YANDEX capability=on_off\/on result=ERROR code=INTERNAL_ERROR/);
    assert.doesNotMatch(log,/setForeignStateAsync resolved/);
});
test('missing binding produces a meaningful trace without attempting a write',async()=>{
    const h=harness(true);
    const req={...ACTION,capabilities:[{type:'devices.capabilities.on_off',state:{instance:'bad',value:true}}]};
    const out=await h.bridge.action('1',[req],{requestId:'req-4'});
    assert.equal(out[0].capabilities[0].state.action_result.error_code,'INVALID_ACTION');
    assert.equal(h.writes.length,0);
    assert.match(h.logs.info.join('\n'),/REJECT binding missing: on_off\/bad/);
});
test('unsafe sensitive strings in incoming action values are redacted and log injection is flattened',()=>{
    assert.equal(safeTraceValue('Bearer my-secret-token'),'[REDACTED]');
    assert.equal(safeTraceValue('https://user:password@example.com'),'[REDACTED]');
    const h=harness(true);
    const {traceAction}=require('../lib/action-trace');
    traceAction(h.config,h.log,'req\nmalicious','test','HTTP','line\nINJECT');
    assert.equal(h.logs.info.length,1);
    assert.ok(!h.logs.info[0].includes('\n'));
    assert.match(h.logs.info[0],/req=req_malicious/);
});
test('provider action request correlates HTTP and bridge traces without logging Bearer token',async(t)=>{
    const h=harness(true);
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yud-trace-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const config={...h.config,oauthClientId:'test-app',oauthClientSecret:'test-secret',oauthLogin:'test-user',oauthPassword:'test-pass'};
    const oauth=new LocalOAuth(config,dir,h.log);
    // HTTP tests from the base release use real provider tokens. This test uses
    // a minimal valid token stub to exercise only the action handler logging.
    const token='test-Bearer-token-must-not-be-in-log';
    oauth.validate=raw=>raw===token?'1':null;
    const server=createProviderServer(h.bridge,config,h.log,oauth);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const res=await fetch('http://127.0.0.1:'+server.address().port+'/provider/v1.0/user/devices/action',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Request-Id':'trace-http-1'},
        body:JSON.stringify({payload:{devices:[ACTION]}})
    });
    assert.equal(res.status,200);
    assert.equal((await res.json()).payload.devices[0].capabilities[0].state.action_result.status,'DONE');
    const log=h.logs.info.join('\n');
    assert.match(log,/req=trace-http-1 device=\* HTTP POST \/user\/devices\/action devices=1/);
    assert.match(log,/req=trace-http-1 device=vorota_garage TRANSFORM input=true output="OPEN"/);
    assert.ok(!log.includes(token));
});
