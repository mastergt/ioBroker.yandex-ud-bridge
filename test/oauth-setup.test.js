'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { generate, generateAccount, allEmpty, addresses, externalBase } = require('../admin/oauth-setup');

test('oauth bootstrap uses cryptographically random values and generates valid fields', () => {
    const a = generate(webcrypto), b = generate(webcrypto);
    assert.match(a.oauthClientId, /^[a-f0-9]{32}$/);
    assert.match(a.oauthClientSecret, /^[a-f0-9]{64}$/);
    assert.match(a.oauthPassword, /^[a-f0-9]{40}$/);
    assert.equal(a.oauthLogin, 'home');
    assert.notEqual(a.oauthClientId, b.oauthClientId);
    assert.notEqual(a.oauthClientSecret, b.oauthClientSecret);
    assert.notEqual(a.oauthPassword, b.oauthPassword);
    assert.equal(allEmpty({}), true);
    assert.equal(allEmpty(a), false);
    assert.throws(() => generate({}), /WebCrypto/);
});

test('external endpoint renders four fixed URLs without leaking local port or plain HTTP',()=>{
    assert.equal(externalBase('  https://smart.example.ru/  '),'https://smart.example.ru');
    assert.deepEqual(addresses('https://smart.example.ru'),{
        provider:'https://smart.example.ru/provider/',
        authorize:'https://smart.example.ru/oauth/authorize',
        token:'https://smart.example.ru/oauth/token',
        refresh:'https://smart.example.ru/oauth/token'
    });
    assert.equal(addresses(''), null);
    for(const bad of ['http://home.example.ru','https://user:password@home.example.ru','https://home.example.ru/prefix','https://home.example.ru/?token=x','not a url']){
        assert.throws(()=>addresses(bad));
    }
});

function page(config){
    const nodes=new Map(), events=new Map(), changes=[], clipped=[];
    const el=sel=>{
        if(!nodes.has(sel))nodes.set(sel,{innerHTML:'',textContent:'',hidden:true,className:'',value:'',classList:{toggle(){}}});
        return nodes.get(sel);
    };
    const window={
        crypto:webcrypto, BridgeOAuthSetup:{generate,generateAccount,allEmpty,addresses,externalBase},
        navigator:{clipboard:{writeText:async s=>clipped.push(s)}},
        instance:0,
        confirm:()=>true,
        sendTo(_inst,cmd,_params,callback){
            if(cmd==='candidates')callback([]);
            else if(cmd==='categories') callback({rooms:[],functions:[]});
            else throw Error('Unexpected sendTo: '+cmd);
        },
        socket:{emit(command,_key,cb){assert.equal(command,'getObject');cb(null,{native:{devices:[],bindings:[]}});}}
    };
    const document={
        documentElement:{dataset:{bridgeMode:'settings'}},
        querySelector:el,querySelectorAll:()=>[],getElementById:id=>el('#'+id),
        addEventListener:(name,cb)=>{const a=events.get(name)||[];a.push(cb);events.set(name,a);}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'), {window,document,setTimeout(){return 1},clearTimeout(){},console});
    window.load({...config,devices:[],bindings:[]}, (...args)=>changes.push(args));
    const click=(dataset)=>{
        const target={dataset,tagName:'BUTTON',type:'button',closest(q){
            if(q==='[data-action]' && dataset.action)return this;
            if(q==='[data-view]' && dataset.view)return this;
            return null;
        }};
        const event={target,preventDefault(){}};
        for(const cb of events.get('click')||[])cb(event);
    };
    return {click,save:()=>new Promise(resolve=>window.save(resolve)),nodes,changes,clipped};
}

test('settings page generates OAuth client and login in one click, preserving devices and config',async()=>{
    const p=page({oauthUserId:'1',listenPort:8096,publicBaseUrl:'https://smart.example.ru'});
    p.click({view:'auth'});
    assert.match(p.nodes.get('#content').innerHTML,/Первоначальная настройка/);
    p.click({action:'oauth-generate'});
    const saved=await p.save();
    assert.match(saved.oauthClientId,/^[a-f0-9]{32}$/);
    assert.match(saved.oauthClientSecret,/^[a-f0-9]{64}$/);
    assert.match(saved.oauthPassword,/^[a-f0-9]{40}$/);
    assert.equal(saved.oauthLogin,'home');
    assert.equal(saved.oauthUserId,'1');
    assert.equal(saved.listenPort,8096);
    assert.equal(saved.publicBaseUrl,'https://smart.example.ru');
    assert.match(p.nodes.get('#content').innerHTML,/Скопировать параметры для Яндекса/);
    p.click({action:'oauth-copy-all'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(p.clipped[0],/https:\/\/smart.example.ru\/provider\//);
    assert.match(p.clipped[0],new RegExp(saved.oauthClientId));
    assert.match(p.clipped[0],new RegExp(saved.oauthClientSecret));
    p.click({action:'oauth-generate'});
    const again=await p.save();
    assert.equal(again.oauthClientSecret,saved.oauthClientSecret,'must never silently rotate client secret');
});

test('OAuth generator refuses partially-configured instances to avoid silently revoking skill credentials',async()=>{
    const p=page({oauthClientId:'existing-client',oauthClientSecret:'',oauthLogin:'',oauthPassword:'',oauthUserId:'1'});
    p.click({view:'auth'});
    p.click({action:'oauth-generate'});
    const saved=await p.save();
    assert.equal(saved.oauthClientId,'existing-client');
    assert.equal(saved.oauthClientSecret,'');
    assert.equal(saved.oauthLogin,'');
    assert.equal(saved.oauthPassword,'');
});


test('OAuth login password rotation does not replace published Yandex client credentials', async () => {
    const original={oauthClientId:'admin',oauthClientSecret:'existing-client-secret',oauthLogin:'my-user',oauthPassword:'old-password',oauthUserId:'1'};
    const p=page(original);
    p.click({view:'auth'});
    const markup=p.nodes.get('#content').innerHTML;
    assert.match(markup,/Реквизиты приложения/);
    assert.match(markup,/Учётная запись для входа/);
    assert.match(markup,/Создать новый пароль для входа/);
    p.click({action:'oauth-reset-login'});
    const next=await p.save();
    assert.equal(next.oauthClientId,'admin');
    assert.equal(next.oauthClientSecret,'existing-client-secret');
    assert.equal(next.oauthLogin,'my-user');
    assert.match(next.oauthPassword,/^[a-f0-9]{40}$/);
    assert.notEqual(next.oauthPassword,'old-password');
    p.click({action:'oauth-copy',field:'oauthPassword'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(p.clipped[0],next.oauthPassword);
});

test('OAuth account generator uses WebCrypto and does not mutate the client', () => {
    const first=generateAccount(webcrypto,'already-configured');
    const second=generateAccount(webcrypto,'already-configured');
    assert.equal(first.oauthLogin,'already-configured');
    assert.equal(generateAccount(webcrypto,'').oauthLogin,'home');
    assert.match(first.oauthPassword,/^[a-f0-9]{40}$/);
    assert.notEqual(first.oauthPassword,second.oauthPassword);
    assert.deepEqual(Object.keys(first).sort(),['oauthLogin','oauthPassword']);
});
