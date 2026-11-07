'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { preset, recognize, inputKeys, outputKeys } = require('../admin/pressure-units');
const { applyTransform } = require('../lib/transforms');
const { capabilityDefinition, toYandex } = require('../lib/bridge');

function instance(config = {}) {
    const listeners = {};
    const elements = new Map();
    const element = selector => {
        if (!elements.has(selector)) elements.set(selector, {
            innerHTML: '', textContent: '', value: '', hidden: false, classList:{toggle(){}},
            addEventListener(){}
        });
        return elements.get(selector);
    };
    const document = {
        documentElement:{dataset:{bridgeMode:'tab'}}, body:{dataset:{bridgeMode:'tab'}},
        querySelector:element, querySelectorAll(){return [];},
        addEventListener(event, callback){(listeners[event]||=[]).push(callback);}
    };
    const window = {
        YudPressureUnits:require('../admin/pressure-units'),
        instance:0,
        bridgeTabSend(command, params, cb){
            if(command === 'candidates') cb([]);
            else if(command === 'categories') cb({rooms:[],functions:[]});
            else cb({});
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),{
        document,window,console,setTimeout,clearTimeout
    });
    const binding = {
        kind:'property',type:'float',instance:'pressure',deviceId:'room',
        stateId:'zigbee.0.room.pressure',enabled:true,retrievable:true,
        reportable:false, commandId:'', mapping:'', writeTransform:'',readTransform:'',
        parameters:JSON.stringify({instance:'pressure',unit:'unit.pressure.mmhg',note:'preserve-me'}),
        ...config
    };
    window.load({oauthUserId:'1',devices:[{id:'room',type:'devices.types.sensor',name:'Комната',enabled:true}], bindings:[binding]},()=>{});
    function action(name,index){
        const element={dataset:{action:name,index:String(index)},tagName:'BUTTON',type:'button',
            closest(selector){return selector==='[data-action]'?this:null;}};
        for(const fn of listeners.click||[])fn({target:element,preventDefault(){}});
    }
    function save(){let value;window.save(x=>value=JSON.parse(JSON.stringify(x)));return value;}
    return {action,save,html:()=>element('#content').innerHTML,element};
}

test('hPa converts to Yandex mmHg, Pa, bar and atm',()=>{
    const reading = 1007.94;
    const expected = {
        mmhg: 756.016, pa:100794, bar:1.00794, atm:0.9947624
    };
    for (const [target,number] of Object.entries(expected)) {
        const p = preset('hpa',target);
        const output = applyTransform(reading,p.readTransform);
        assert.ok(Math.abs(output-number) < 0.004, `${target}: ${output}`);
        assert.match(p.unit,/^unit\.pressure\.(mmhg|pascal|bar|atm)$/);
        assert.deepEqual(recognize({instance:'pressure',unit:p.unit},p.readTransform),{input:'hpa',output:target});
    }
});

test('each supported source converts via Pascal canonical mapping without precision loss',()=>{
    assert.equal(inputKeys.length,6);
    assert.equal(outputKeys.length,4);
    for(const source of inputKeys) for(const target of outputKeys){
        const p=preset(source,target);
        const result=applyTransform(1007.94,p.readTransform);
        assert.ok(Number.isFinite(result));
        assert.equal(recognize(JSON.stringify({unit:p.unit}),JSON.stringify(p.readTransform)).input,source);
    }
    assert.throws(()=>preset('ppm','mmhg'),/Неподдерживаемые/);
    assert.throws(()=>preset('hpa','ppm'),/Неподдерживаемые/);
});

test('existing manual pressure conversion is preserved on opening and saving',()=>{
    const manual=JSON.stringify({type:'scale',from:[0,1000],to:[0,750.061683]});
    const ui=instance({readTransform:manual});
    ui.action('open',0);ui.action('toggle-function',0);
    assert.match(ui.html(),/Источник ioBroker/);
    assert.match(ui.html(),/Передать в Яндекс/);
    assert.match(ui.html(),/value="hpa" selected/); // recognizes previous manual scale
    const saved=ui.save().bindings[0];
    assert.equal(saved.readTransform,manual);
    assert.equal(saved.parameters,JSON.stringify({instance:'pressure',unit:'unit.pressure.mmhg',note:'preserve-me'}));
});

test('apply pressure preset updates only pressure unit + read conversion, never other settings',()=>{
    const ui=instance({readTransform:JSON.stringify({type:'threshold',operator:'gt',value:10})});
    ui.action('open',0);ui.action('toggle-function',0);
    ui.element('[data-pressure-source="0"]').value='hpa';
    ui.element('[data-pressure-target="0"]').value='mmhg';
    ui.action('apply-pressure-preset',0);
    const saved=ui.save().bindings[0];
    assert.equal(JSON.parse(saved.parameters).note,'preserve-me');
    assert.equal(JSON.parse(saved.parameters).unit,'unit.pressure.mmhg');
    assert.equal(saved.stateId,'zigbee.0.room.pressure');
    assert.equal(saved.retrievable,true);
    assert.equal(saved.writeTransform,'');
    assert.ok(Math.abs(toYandex(1007.94,saved)-756.016)<0.004);
    assert.equal(capabilityDefinition(saved).parameters.unit,'unit.pressure.mmhg');
});

test('blank source or malformed parameters leaves old mapping intact with a message',()=>{
    const ui=instance();
    ui.action('open',0);ui.action('toggle-function',0);
    ui.element('[data-pressure-source="0"]').value='';
    ui.element('[data-pressure-target="0"]').value='mmhg';
    ui.action('apply-pressure-preset',0);
    assert.match(ui.element('#notice').textContent,/Выберите исходную единицу/);
    assert.equal(ui.save().bindings[0].readTransform,'');
    const broken=instance({parameters:'{broken',readTransform:''});
    broken.action('open',0);broken.action('toggle-function',0);
    broken.element('[data-pressure-source="0"]').value='hpa';
    broken.element('[data-pressure-target="0"]').value='mmhg';
    broken.action('apply-pressure-preset',0);
    assert.match(broken.element('#notice').textContent,/исправьте JSON/);
});

test('preset helper loads before editor in both Admin entrypoints',()=>{
    for(const filename of ['tab_m.html','index_m.html']) {
        const content=fs.readFileSync(path.join(__dirname,'../admin',filename),'utf8');
        assert.ok(content.indexOf('src="pressure-units.js"') < content.indexOf('src="editor.js"'));
        assert.match(content,/src="pressure-units\.js"/);
    }
});


test('existing invalid ppm metadata becomes supported pressure unit only on explicit Apply',()=>{
    const row={parameters:JSON.stringify({instance:'pressure',unit:'unit.ppm',note:'unchanged'})};
    const ui=instance(row);
    ui.action('open',0);ui.action('toggle-function',0);
    assert.equal(JSON.parse(ui.save().bindings[0].parameters).unit,'unit.ppm');
    ui.element('[data-pressure-source="0"]').value='hpa';
    ui.element('[data-pressure-target="0"]').value='mmhg';
    ui.action('apply-pressure-preset',0);
    const converted=ui.save().bindings[0];
    assert.equal(JSON.parse(converted.parameters).unit,'unit.pressure.mmhg');
    assert.equal(JSON.parse(converted.parameters).note,'unchanged');
    assert.ok(Math.abs(toYandex(1007.94,converted)-756.016)<0.004);
});
