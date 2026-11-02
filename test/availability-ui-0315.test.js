'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {Bridge} = require('../lib/bridge');

function editor(config) {
    const elements = new Map(), listeners = {};
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            innerHTML:'', textContent:'', hidden:false, className:'', value:'',
            classList:{toggle(){}}, focus(){}, setSelectionRange(){},open:false,showModal(){this.open=true;},close(){this.open=false;},setAttribute(){},removeAttribute(){}
        });
        return elements.get(id);
    };
    const document = {
        documentElement:{dataset:{bridgeMode:'tab'}}, body:{dataset:{bridgeMode:'tab'}},
        querySelector:element, getElementById:id=>element('#'+id), querySelectorAll:()=>[],
        addEventListener(name,cb){(listeners[name] ||= []).push(cb);}
    };
    const jq = () => ({selectId(method,...args) {
        if(method==='init')return this;
        if(method==='show')args[1](window.selection);
        return this;
    }});
    jq.fn={selectId(){}};
    const window={instance:0,confirm:()=>true,jQuery:jq,
        socket:{emit(cmd,callback){assert.equal(cmd,'getObjects');callback(null,{'zigbee.0.device.available':{type:'state',common:{}}});}},
        bridgeTabSend(cmd,params,done){if(cmd==='candidates')done([{id:'zigbee.0.device.available',name:'Available',role:'indicator.connected',objectType:'state'}]);else if(cmd==='categories')done({rooms:[],functions:[]});else done({});}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),{document,window,setTimeout,clearTimeout,console});
    window.load(config,()=>{});
    function fire(kind,target) {for(const cb of listeners[kind]||[])cb({target,preventDefault(){}});}
    function click(action,index) {
        const el={dataset:{action,index:String(index??'')},tagName:'BUTTON',closest(sel){return sel==='[data-action]'?this:null;}};
        fire('click',{closest:sel=>el.closest(sel) ? el : null});
    }
    function pick(value) {
        window.selection=value;
        const el={dataset:{action:'pick-state',path:'devices.0.onlineStateId'},tagName:'BUTTON',closest(sel){return sel==='[data-action]'?this:null;}};
        fire('click',{closest:sel=>el.closest(sel) ? el : null});
        fire('click',{closest:sel=>sel==='[data-state-index]'?{dataset:{stateIndex:'0'}}:null});
    }
    function change(bind,checked){fire('change',{dataset:{bind},type:'checkbox',checked,tagName:'INPUT'});}
    function save(){let result;window.save(data=>result=JSON.parse(JSON.stringify(data)));return result;}
    return {element,click,pick,change,save,html:()=>element('#content').innerHTML};
}
const base={id:'door',name:'Дверь',type:'devices.types.sensor.open',enabled:true};
const prop={deviceId:'door',kind:'property',type:'event',instance:'open',stateId:'zigbee.0.device.open',enabled:true,retrievable:true};

test('legacy onlineStateId appears as a compact property next to existing opening function',()=>{
    const data={devices:[{...base,onlineStateId:'zigbee.0.device.available',onlineInvert:true}],bindings:[prop]};
    const ui=editor(data);
    ui.click('open',0);
    const html=ui.html();
    assert.match(html,/Возможности и свойства/);
    assert.match(html,/Открытие \/ закрытие/);
    assert.match(html,/<div class="function-title">Доступность<\/div>/);
    assert.equal((html.match(/class="function-box/g)||[]).length,2);
    assert.doesNotMatch(html,/Доступность устройства · online/);
    const oldIndex=html.indexOf('Открытие / закрытие');
    assert.ok(html.indexOf('Доступность',oldIndex)>oldIndex);
    assert.equal(ui.save().devices[0].onlineStateId,data.devices[0].onlineStateId);
    assert.equal(ui.save().devices[0].onlineInvert,true);
    assert.deepEqual(ui.save().bindings,[prop]);
    ui.click('toggle-availability');
    assert.match(ui.html(),/Объект ioBroker \(available \/ online\)/);
    assert.match(ui.html(),/devices\.0\.onlineInvert/);
    assert.match(ui.html(),/zigbee\.0\.device\.available/);
});

test('availability can be added, selected, disabled, reenabled, and removed without touching bindings',()=>{
    const ui=editor({devices:[{...base}],bindings:[prop]});
    ui.click('open',0);
    assert.doesNotMatch(ui.html(),/class="availability-property/);
    const found=ui.html().match(/option value="(\d+)">Свойство — Доступность/);
    assert.ok(found,'new property selectable in functions menu');
    ui.element('#add-function-select').value=found[1];
    ui.click('add-function');
    assert.match(ui.html(),/class="function-box availability-property/);
    assert.match(ui.html(),/Объект ioBroker \(available \/ online\)/);
    ui.pick('zigbee.0.device.available');
    assert.equal(ui.save().devices[0].onlineStateId,'zigbee.0.device.available');
    ui.click('toggle-availability'); // collapse, then toggle active via bound checkbox
    ui.change('devices.0.onlineEnabled',false);
    assert.equal(ui.save().devices[0].onlineEnabled,false);
    assert.match(ui.html(),/Свойство · Не активно/);
    ui.change('devices.0.onlineEnabled',true);
    assert.equal(ui.save().devices[0].onlineEnabled,true);
    // Adding the same property should not overwrite a previous selection.
    ui.element('#add-function-select').value=found[1];ui.click('add-function');
    assert.equal(ui.save().devices[0].onlineStateId,'zigbee.0.device.available');
    ui.click('remove-availability');
    const saved=ui.save();
    assert.equal(saved.devices[0].onlineStateId,'');
    assert.equal(saved.devices[0].onlineInvert,false);
    assert.equal(saved.devices[0].onlineEnabled,false);
    assert.deepEqual(saved.bindings,[prop]);
    assert.doesNotMatch(ui.html(),/class="function-box availability-property/);
});

test('new availability UI remains a Yandex status and is never advertised as fake property',async()=>{
    const states=new Map([['zigbee.0.device.available',false],['zigbee.0.device.open',true]]);
    const device={...base,onlineStateId:'zigbee.0.device.available',onlineInvert:false,onlineEnabled:true};
    const config={oauthUserId:'1',devices:[device],bindings:[prop],callbackEnabled:true,callbackSkillId:'skill',callbackOauthToken:'token'};
    const transport={getState:async id=>states.get(id),setState:async()=>{}};
    const bridge=new Bridge(config,transport);
    assert.equal(bridge.discover('1')[0].properties.length,1);
    assert.equal(bridge.discover('1')[0].properties[0].type,'devices.properties.event');
    assert.equal(bridge.discover('1')[0].status_info.reportable,true);
    assert.equal((await bridge.query('1',[{id:'door'}]))[0].error_code,'DEVICE_UNREACHABLE');
    assert.ok(bridge.onlineIndex.has('zigbee.0.device.available'));
    const disabled=new Bridge({...config,devices:[{...device,onlineEnabled:false}]},transport);
    assert.equal(disabled.discover('1')[0].status_info.reportable,false);
    assert.equal(disabled.onlineIndex.size,0);
    assert.equal((await disabled.query('1',[{id:'door'}]))[0].properties.length,1);
    assert.deepEqual(await disabled.onStateChange('zigbee.0.device.available',false),[]);
    // Legacy device with no onlineEnabled flag remains gated by onlineStateId.
    const legacy=new Bridge({...config,devices:[{...device,onlineEnabled:undefined}]},transport);
    assert.equal((await legacy.query('1',[{id:'door'}]))[0].error_code,'DEVICE_UNREACHABLE');
});
