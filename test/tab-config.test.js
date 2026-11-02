'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {editable,revision,validatedChange}=require('../lib/tab-config');

test('sidebar config exposes only devices/bindings, never OAuth secrets',()=>{
    const native={oauthClientSecret:'PRIVATE',oauthPassword:'SECRET',devices:[{id:'light'}],bindings:[]};
    assert.deepEqual(editable(native),{devices:[{id:'light'}],bindings:[]});
    const r=revision(native);
    assert.equal(r,revision({devices:[{id:'light'}],bindings:[],oauthClientSecret:'OTHER'}));
    assert.deepEqual(validatedChange({revision:r, devices:[{id:'light',name:'My Light'}],bindings:[]},r),{
        devices:[{id:'light',name:'My Light'}],bindings:[]
    });
    assert.throws(()=>validatedChange({revision:'stale',devices:[],bindings:[]},r),/изменена/);
    assert.throws(()=>validatedChange({revision:r,devices:[{id:'a'},{id:'a'}],bindings:[]},r),/уникальными/);
    assert.throws(()=>validatedChange({revision:r,devices:[],bindings:[{deviceId:'not-found'}]},r),/без существующего/);
});

test('Admin sidebar ships tab_m.html, native selectID, scoped editor and adminTab',()=>{
    const cfg=require('../io-package.json');
    assert.equal(cfg.common.adminUI.tab,'html');
    assert.equal(cfg.common.adminTab.link,'/adapter/yandex-ud-bridge/tab_m.html');
    assert.ok(cfg.common.adminTab.link.startsWith('/adapter/'+cfg.common.name+'/'));
    assert.ok(fs.existsSync(path.join(__dirname,'../admin',path.posix.basename(cfg.common.adminTab.link))), 'sidebar target must exist among uploaded admin files');
    assert.equal(cfg.common.adminTab.singleton,true);
    const tab=fs.readFileSync(path.join(__dirname,'../admin/tab_m.html'),'utf8');
    const settings=fs.readFileSync(path.join(__dirname,'../admin/index_m.html'),'utf8');
    for(const part of ['tab-controller.js','editor.js','state-picker-dialog','data-view="devices"','data-view="diagnostic"'])assert.ok(tab.includes(part),`missing ${part}`);
    assert.doesNotMatch(tab,/data-view="auth"|data-view="server"/);
    assert.match(settings,/data-view="auth"/);
    assert.match(settings,/data-view="migration"/);
    assert.doesNotMatch(settings,/data-view="devices"/);
});


test('old per-device allowedUsers is excluded from sidebar and stripped when saving', () => {
    const native={devices:[{id:'light',name:'Light',allowedUsers:'123'}],bindings:[],oauthPassword:'PRIVATE'};
    const shown=editable(native);
    assert.equal(shown.devices[0].allowedUsers,undefined);
    assert.equal(native.devices[0].allowedUsers,'123'); // reading does not mutate saved config
    const clean=validatedChange({revision:revision(native),devices:[{id:'light',name:'Light',allowedUsers:'999'}],bindings:[]},revision(native));
    assert.deepEqual(clean.devices,[{id:'light',name:'Light'}]);
    assert.equal(clean.oauthPassword,undefined);
});

test('device editor has no per-device users field; OAuth identity setting remains', () => {
    const editor=fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8');
    assert.doesNotMatch(editor,/textField\('Доступно пользователям/);
    assert.doesNotMatch(editor,/devices\.\$\{i\}\.allowedUsers/);
    assert.match(editor,/oauthUserId/);
    const legacy=fs.readFileSync(path.join(__dirname,'../lib/legacy.js'),'utf8');
    assert.doesNotMatch(legacy,/d\.allowedUsers/);
});
