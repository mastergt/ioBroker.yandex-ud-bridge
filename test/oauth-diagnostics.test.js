'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalOAuth } = require('../lib/oauth');
const { createProviderServer } = require('../lib/server');
const { runOAuthDiagnostic } = require('../lib/diagnostics');
const { Bridge } = require('../lib/bridge');

const config = { oauthClientId:'diagnostic-app',oauthClientSecret:'sensitive-secret',oauthLogin:'demo-user',oauthPassword:'SENSITIVE-password',oauthUserId:'12',devices:[{id:'desk',name:'Test lamp',type:'devices.types.light',enabled:true}],bindings:[{deviceId:'desk',kind:'capability',type:'on_off',instance:'on',stateId:'light.power',enabled:true,retrievable:true}] };
const log = {warn() {},error() {},info() {}};
async function fixture(t, options={}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'yandex-ud-diag-'));
    const cfg={...config,...options};
    const state=new Map([['light.power',true]]);
    let writes=0;
    const bridge=new Bridge(cfg,{getState:async id=>state.get(id),setState:async()=>{writes++;}});
    const oauth=new LocalOAuth(cfg,dir,log);
    const server=createProviderServer(bridge,cfg,log,oauth);
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
    return {server,oauth,bridge,config:cfg,writes:()=>writes};
}

test('diagnostic performs HTTP authorization, token, discovery, read and refresh without writes', async t=>{
    const f=await fixture(t);
    const result=await runOAuthDiagnostic(f);
    assert.equal(result.ok,true,JSON.stringify(result.steps));
    assert.deepEqual(result.steps.map(step=>step.id),['config','http','unauthorized','authorization','token','discovery','query','refresh']);
    assert.equal(result.steps.every(s=>s.status==='ok'),true);
    assert.equal(result.deviceCount,1);
    assert.equal(f.writes(),0);
    assert.deepEqual(Object.keys(f.oauth.tokens.access),[]);
    assert.deepEqual(Object.keys(f.oauth.tokens.refresh),[]);
    assert.equal(fs.readFileSync(f.oauth.file,'utf8').includes('sensitive-secret'),false);
    const serialized=JSON.stringify(result);
    assert.doesNotMatch(serialized,/SENSITIVE-password|sensitive-secret|access_token|refresh_token|Basic /);
});

test('diagnostic preserves pre-existing real access and refresh tokens',async t=>{
    const f=await fixture(t);
    const n=f.oauth.authRequest({client_id:config.oauthClientId,response_type:'code',redirect_uri:'https://social.yandex.net/broker/redirect'});
    const code=new URL(f.oauth.login({nonce:n,username:config.oauthLogin,password:config.oauthPassword}).location).searchParams.get('code');
    const result=f.oauth.tokenRequest({grant_type:'authorization_code',code,redirect_uri:'https://social.yandex.net/broker/redirect'},{id:config.oauthClientId,secret:config.oauthClientSecret});
    const original=result.body;
    const checked=await runOAuthDiagnostic(f);
    assert.equal(checked.ok,true);
    assert.equal(f.oauth.validate(original.access_token),'12');
    assert.equal(Object.keys(f.oauth.tokens.access).length,1);
    assert.equal(Object.keys(f.oauth.tokens.refresh).length,1);
    const rotated=f.oauth.tokenRequest({grant_type:'refresh_token',refresh_token:original.refresh_token},{id:config.oauthClientId,secret:config.oauthClientSecret});
    assert.equal(rotated.status,200);
});

test('missing OAuth configuration is reported without generating tokens',async t=>{
    const f=await fixture(t,{oauthPassword:''});
    const result=await runOAuthDiagnostic(f);
    assert.equal(result.ok,false);
    assert.equal(result.steps.length,1);
    assert.equal(result.steps[0].id,'config');
    assert.equal(result.steps[0].status,'error');
    assert.deepEqual(f.oauth.tokens.access,{});
});

test('empty discovery yields warning but successful OAuth',async t=>{
    const f=await fixture(t,{devices:[],bindings:[]});
    const result=await runOAuthDiagnostic(f);
    assert.equal(result.ok,true);
    assert.equal(result.deviceCount,0);
    assert.equal(result.steps.find(x=>x.id==='discovery').status,'warning');
    assert.equal(result.steps.find(x=>x.id==='query').status,'warning');
});

test('stopped local server is diagnosed without token issuance',async t=>{
    const f=await fixture(t);
    await new Promise(resolve=>f.server.close(resolve));
    const result=await runOAuthDiagnostic(f);
    assert.equal(result.ok,false);
    assert.equal(result.steps.at(-1).id,'http');
    assert.deepEqual(f.oauth.tokens.access,{});
});
