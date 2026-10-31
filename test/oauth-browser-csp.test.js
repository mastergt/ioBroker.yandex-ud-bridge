'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LocalOAuth}=require('../lib/oauth');
const {createProviderServer}=require('../lib/server');

const conf={ oauthClientId:'admin',oauthClientSecret:'client-secret',oauthLogin:'Yandex',oauthPassword:'password123',oauthUserId:'1' };
const redirect='https://social.yandex.net/broker/redirect';
const yandexState='https://social.yandex.ru/broker2/authz_in_web/abcd/callback';

test('login form CSP permits Yandex OAuth redirect, blocks unrelated form targets',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yb-csp-'));
  const oauth=new LocalOAuth(conf,dir,{warn:()=>{}});
  const server=createProviderServer({discover:()=>[]},conf,{warn:()=>{}},oauth);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const u=new URL(`http://127.0.0.1:${server.address().port}/oauth/authorize`);
  u.searchParams.set('state',yandexState);
  u.searchParams.set('redirect_uri',redirect);
  u.searchParams.set('response_type','code');
  u.searchParams.set('client_id','admin');
  const page=await fetch(u);
  assert.equal(page.status,200);
  const csp=page.headers.get('content-security-policy');
  const directive=csp.split(';').map(v=>v.trim()).find(v=>v.startsWith('form-action '));
  assert.equal(directive,"form-action 'self' https://social.yandex.net https://social.yandex.ru");
  assert.ok(directive.includes('https://social.yandex.ru'), 'Yandex broker second-hop callback must be allowed');
  assert.ok(!directive.includes('https://example.org'), 'Unrelated hosts are not allowed');
  assert.ok(csp.includes("default-src 'none'"),'other resource types remain restricted');
  const formHtml=await page.text();
  assert.ok(formHtml.includes('<form method="post" action="/oauth/authorize">'));
  const nonce=/name="nonce" value="([^"]+)"/.exec(formHtml)?.[1];
  assert.ok(nonce,'form must include a nonce');
  const result=await fetch(new URL('/oauth/authorize',u),{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({nonce,username:'Yandex',password:'password123'}),
    redirect:'manual'
  });
  assert.equal(result.status,302);
  const dest=new URL(result.headers.get('location'));
  assert.equal(dest.origin,'https://social.yandex.net');
  assert.equal(dest.pathname,'/broker/redirect');
  assert.equal(dest.searchParams.get('state'),yandexState);
  assert.ok(dest.searchParams.get('code'));
  const reused=await fetch(new URL('/oauth/authorize',u),{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({nonce,username:'Yandex',password:'password123'}),
    redirect:'manual'
  });
  assert.equal(reused.status,400,'nonce must be single-use');
});
