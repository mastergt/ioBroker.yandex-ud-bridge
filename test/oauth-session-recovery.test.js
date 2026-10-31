'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LocalOAuth } = require('../lib/oauth');
const { createProviderServer } = require('../lib/server');

const config = { oauthClientId: 'admin', oauthClientSecret: 'secret-client', oauthLogin: 'Yandex', oauthPassword: 'secret-login', oauthUserId: '1' };
const state='https://social.yandex.ru/broker2/authz_in_web/d4f1f34ca0ff651d8d67e21d98470011/callback';
const redirect_uri='https://social.yandex.net/broker/redirect';
const mockBridge={ discover:()=>[], query:async()=>[],action:async()=>[] };
const logger={warn:()=>{}};
function temp(t) { const d=fs.mkdtempSync(path.join(os.tmpdir(),'oauth-pending-')); t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d; }
function params(){return {client_id:'admin',response_type:'code',redirect_uri,state};}

test('real Yandex URL is accepted and pending authorize survives adapter restart', t => {
    const dir=temp(t);
    let now=1_600_000_000_000;
    const first=new LocalOAuth(config,dir,logger,()=>now);
    const nonce=first.authRequest(params());
    assert.ok(nonce.length>25);
    assert.equal(fs.statSync(first.pendingFile).mode & 0o777,0o600);
    assert.ok(!fs.readFileSync(first.pendingFile,'utf8').includes(nonce));
    now += 4*60_000;
    const second=new LocalOAuth(config,dir,logger,()=>now);
    const login=second.login({nonce,username:'Yandex',password:'secret-login'});
    assert.ok(login.location);
    const location=new URL(login.location);
    assert.equal(location.searchParams.get('state'),state);
    assert.equal(location.searchParams.get('client_id'),'admin');
    assert.equal(location.origin,'https://social.yandex.net');
    assert.equal(location.pathname,'/broker/redirect');
    const another=new LocalOAuth(config,dir,logger,()=>now);
    assert.equal(another.login({nonce,username:'Yandex',password:'secret-login'}).status,400,'used nonce should not be replayable after restart');
});

test('new nonce is valid for 15 minutes but not after expiry',t=>{
    const dir=temp(t);
    let now=1_600_000_000_000;
    const first=new LocalOAuth(config,dir,logger,()=>now);
    const nonce=first.authRequest(params());
    now+=15*60_000-1;
    const second=new LocalOAuth(config,dir,logger,()=>now);
    assert.ok(second.login({nonce,username:'Yandex',password:'secret-login'}).location);
    const anotherNonce=second.authRequest(params());
    now+=15*60_000+1;
    const third=new LocalOAuth(config,dir,logger,()=>now);
    assert.equal(third.login({nonce:anotherNonce,username:'Yandex',password:'secret-login'}).status,400);
});

test('HTTP POST authorize after restart redirects with exact Yandex state',async t=>{
    const dir=temp(t);
    let auth=new LocalOAuth(config,dir,logger);
    const baseArgs={bridge:mockBridge,config,log:logger};
    let server=createProviderServer(mockBridge,config,logger,auth);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    let base=`http://127.0.0.1:${server.address().port}`;
    const authorize=new URL('/oauth/authorize',base);
    for(const [k,v] of Object.entries(params())) authorize.searchParams.set(k,v);
    const get=await fetch(authorize);
    assert.equal(get.status,200);
    const page=await get.text();
    const nonce=/name="nonce" value="([^"]+)"/.exec(page)?.[1];
    assert.ok(nonce);
    await new Promise(r=>server.close(r));
    auth=new LocalOAuth(config,dir,logger);
    server=createProviderServer(mockBridge,config,logger,auth);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    t.after(()=>new Promise(r=>server.close(r)));
    base=`http://127.0.0.1:${server.address().port}`;
    const post=await fetch(base+'/oauth/authorize',{method:'POST',body:new URLSearchParams({nonce,username:config.oauthLogin,password:config.oauthPassword}),headers:{'Content-Type':'application/x-www-form-urlencoded'},redirect:'manual'});
    assert.equal(post.status,302);
    const location=new URL(post.headers.get('location'));
    assert.equal(location.searchParams.get('state'),state);
    const code=location.searchParams.get('code');
    const grant=auth.tokenRequest({code,grant_type:'authorization_code',redirect_uri},{id:config.oauthClientId,secret:config.oauthClientSecret});
    assert.equal(grant.status,200);
});

test('missing nonce displays recovery guidance not a reusable login form',async t=>{
    const dir=temp(t),auth=new LocalOAuth(config,dir,logger),server=createProviderServer(mockBridge,config,logger,auth);
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    t.after(()=>new Promise(r=>server.close(r)));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/oauth/authorize`,{method:'POST',body:new URLSearchParams({nonce:'bad',username:'Yandex',password:'bad'})});
    assert.equal(response.status,400);
    const text=await response.text();
    assert.match(text,/начните привязку/);
    assert.doesNotMatch(text,/<form method="post"/);
});
