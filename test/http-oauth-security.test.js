'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { LocalOAuth } = require('../lib/oauth');
const { createProviderServer, loginClientIp } = require('../lib/server');

const credentials = {
    oauthClientId: 'yandex-app', oauthClientSecret: 'test-secret',
    oauthLogin: 'admin', oauthPassword: 'secret-pass', oauthUserId: '2'
};
function createOAuth(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yud-oauth-hardening-'));
    t.after(() => fs.rmSync(dir, {recursive:true,force:true}));
    return new LocalOAuth(credentials, dir, {warn:()=>{}});
}
const authParameters = {
    client_id: 'yandex-app', response_type: 'code',
    redirect_uri: 'https://social.yandex.net/broker/redirect'
};

test('forwarded client address is ignored unless opt-in and request originates on loopback', () => {
    function req(remote, header) {return {socket:{remoteAddress:remote},headers:{'x-real-ip':header}};}
    assert.equal(loginClientIp(req('127.0.0.1','198.51.100.20'),false),'127.0.0.1');
    assert.equal(loginClientIp(req('127.0.0.1','198.51.100.20'),true),'198.51.100.20');
    assert.equal(loginClientIp(req('::1','2001:db8::abcd'),true),'2001:db8::abcd');
    assert.equal(loginClientIp(req('::ffff:127.0.0.1','192.0.2.9'),true),'192.0.2.9');
    assert.equal(loginClientIp(req('192.0.2.50','198.51.100.20'),true),'192.0.2.50');
    assert.equal(loginClientIp(req('127.0.0.1','198.51.100.20, 127.0.0.1'),true),'127.0.0.1');
    assert.equal(loginClientIp(req('127.0.0.1','untrusted text'),true),'127.0.0.1');
    assert.equal(loginClientIp(req('127.0.0.1',['198.51.100.20']),true),'127.0.0.1');
});

test('HTTP OAuth login throttles the forwarded client individually when trusted Nginx is enabled', async t => {
    const oauth = createOAuth(t);
    const nonce = oauth.authRequest(authParameters);
    const server = createProviderServer({}, {...credentials,trustProxy:true},{warn:()=>{}},oauth);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function attempt(ip) {
        return fetch(base+'/oauth/authorize', {
            method:'POST',
            headers:{'content-type':'application/x-www-form-urlencoded','x-real-ip':ip},
            body:new URLSearchParams({nonce,username:'admin',password:'invalid'})
        });
    }
    for (let i=0; i<6; i++) assert.equal((await attempt('198.51.100.1')).status, 401);
    assert.equal((await attempt('198.51.100.1')).status, 429);
    assert.equal((await attempt('198.51.100.2')).status, 401, 'Another client must not inherit the first lockout');
});

test('OAuth bounds failure buckets and pending authorization requests', t => {
    const oauth=createOAuth(t),nonce=oauth.authRequest(authParameters);
    const now=Date.now();
    for(let i=0;i<4096;i++)oauth.failures.set(`old-${i}`,{count:1,until:now-1});
    const result=oauth.login({nonce,username:'admin',password:'wrong',ip:'192.0.2.1'});
    assert.equal(result.status,401);
    assert.ok(oauth.failures.size<4096, 'Expired buckets must be evicted');
    for(let i=0;i<999;i++)oauth.authRequest(authParameters);
    assert.equal(oauth.requests.size,1000);
    assert.throws(()=>oauth.authRequest(authParameters),/Too many pending OAuth requests/);
});
