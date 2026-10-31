'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {Bridge,toYandex,fromYandex}=require('../lib/bridge');

function editor(config){
    const elements=new Map(),listeners={};
    function element(id){if(!elements.has(id))elements.set(id,{
        innerHTML:'',textContent:'',hidden:false,className:'',classList:{toggle(){}},value:'',focus(){},setSelectionRange(){},
    });return elements.get(id);}
    const document={documentElement:{dataset:{bridgeMode:'tab'}},body:{dataset:{bridgeMode:'tab'}},
        querySelector:element,querySelectorAll(){return [];},addEventListener(name,cb){(listeners[name] ||= []).push(cb);}};
    const $=()=>({selectId(method,...args){if(method==='init')return this;if(method==='show')args[1](window.nextSelection);return this;}});
    $.fn={selectId(){}};
    const window={instance:0,confirm:()=>true,jQuery:$,socket:{emit(cmd,callback){assert.equal(cmd,'getObjects');callback(null,{'state.test':{type:'state',common:{}}});}},
        bridgeTabSend(cmd,params,done){if(cmd==='candidates')done([]);else if(cmd==='categories')done({rooms:[],functions:[]});else done({});}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),
        {document,window,setTimeout,clearTimeout,console});
    window.load(config,()=>{});
    const fire=(event,target)=>{for(const cb of listeners[event]||[]) cb({target,preventDefault(){}});};
    const act=(action,index)=>{const target={dataset:{action,index:String(index??'')},tagName:'BUTTON',closest(sel){return sel==='[data-action]'?this:null;}};fire('click',target);};
    const change=(data,checked,value)=>fire('change',{dataset:data,checked,value,type:'checkbox',tagName:'INPUT'});
    const pick=(path,value)=>{window.nextSelection=value;fire('click',{dataset:{action:'pick-state',path},tagName:'BUTTON',closest(sel){return sel==='[data-action]'?this:null;}});};
    const save=()=>{let out;window.save(data=>{out=JSON.parse(JSON.stringify(data));});return out;};
    return {window,act,change,pick,save,html:()=>element('#content').innerHTML};
}
const device=(id,type='devices.types.light')=>({id,name:id,type,enabled:true,room:''});
const cap=(deviceId,extra={})=>({deviceId,kind:'capability',type:'on_off',instance:'on',enabled:true,retrievable:true,reportable:false,parameters:'',mapping:'',readTransform:'',writeTransform:'',...extra});
const property=(deviceId,extra={})=>({deviceId,kind:'property',type:'float',instance:'temperature',enabled:true,retrievable:true,reportable:false,parameters:'',mapping:'',readTransform:'',writeTransform:'',...extra});

test('single ioBroker selector for old same-object lamp and temperature sensor',()=>{
    const ui=editor({devices:[device('lamp'),device('sensor','devices.types.sensor')],bindings:[cap('lamp',{stateId:'zigbee.0.a.state',commandId:'zigbee.0.a.state'}),property('sensor',{stateId:'zigbee.0.b.temperature'})]});
    ui.act('open',0);ui.act('toggle-function',0);
    assert.match(ui.html(),/Основной объект ioBroker/);
    assert.equal((ui.html().match(/data-action="pick-state" data-path="primary\.0"/g)||[]).length,1);
    assert.doesNotMatch(ui.html(),/Объект обратной связи/);
    ui.act('back');ui.act('open',1);ui.act('toggle-function',1);
    assert.match(ui.html(),/Источник данных ioBroker/);
    assert.doesNotMatch(ui.html(),/Читать состояние из отдельного объекта/);
    assert.equal(ui.save().bindings[0].commandId,'zigbee.0.a.state');
    assert.equal(ui.save().bindings[1].stateId,'zigbee.0.b.temperature');
});

test('reading off/on preserves write destination and never writes to feedback by accident',()=>{
    const ui=editor({devices:[device('lamp')],bindings:[cap('lamp',{stateId:'zigbee.0.a.state'})]});
    ui.act('open',0);ui.act('toggle-function',0);
    ui.change({bind:'bindings.0.retrievable'},false);
    let row=ui.save().bindings[0];
    assert.equal(row.stateId,'');assert.equal(row.commandId,'zigbee.0.a.state');
    assert.equal(row.retrievable,false);
    ui.change({bind:'bindings.0.retrievable'},true);
    row=ui.save().bindings[0];
    assert.equal(row.stateId,'zigbee.0.a.state');assert.equal(row.commandId,'zigbee.0.a.state');
    assert.equal(row.retrievable,true);
});

test('separate feedback can be enabled and changed while command object stays stable',()=>{
    const ui=editor({devices:[device('lamp')],bindings:[cap('lamp',{stateId:'zigbee.0.a.state'})]});
    ui.act('open',0);ui.act('toggle-function',0);
    ui.change({action:'separate-feedback',index:'0'},true);
    assert.match(ui.html(),/Объект обратной связи/);
    ui.pick('bindings.0.stateId','zigbee.0.a.actual');
    assert.equal(ui.save().bindings[0].stateId,'zigbee.0.a.actual');
    assert.equal(ui.save().bindings[0].commandId,'zigbee.0.a.state');
    ui.pick('primary.0','zigbee.0.a.set');
    assert.equal(ui.save().bindings[0].commandId,'zigbee.0.a.set');
    assert.equal(ui.save().bindings[0].stateId,'zigbee.0.a.actual');
    ui.change({action:'separate-feedback',index:'0'},false);
    assert.doesNotMatch(ui.html(),/Объект обратной связи/);
    assert.equal(ui.save().bindings[0].stateId,'zigbee.0.a.set');
    assert.equal(ui.save().bindings[0].commandId,'zigbee.0.a.set');
});

test('gate OPEN/CLOSE mode moves into common write controls, with old values intact',()=>{
    const gate=cap('gate',{stateId:'',commandId:'zigbee.0.gate.cmd',retrievable:false,commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE'});
    const ui=editor({devices:[device('gate','devices.types.openable')],bindings:[gate]});
    ui.act('open',0);ui.act('toggle-function',0);
    assert.match(ui.html(),/Основной объект ioBroker/);
    assert.match(ui.html(),/Команды OPEN \/ CLOSE/);
    assert.match(ui.html(),/value="OPEN"/);
    assert.equal((ui.html().match(/data-action="pick-state" data-path="primary\.0"/g)||[]).length,1);
    assert.doesNotMatch(ui.html(),/Объект команды OPEN \/ CLOSE/);
    assert.equal(ui.save().bindings[0].commandMode,'enum_open_close');
    assert.equal(ui.save().bindings[0].commandId,'zigbee.0.gate.cmd');
    // A configured read transform works even on an old enum_open_close binding.
    assert.equal(toYandex('OPEN',{...gate,readTransform:JSON.stringify({type:'lookup',pairs:[['OPEN',true],['CLOSE',false]]})}),true);
    assert.equal(fromYandex(true,gate),'OPEN');
});

test('changing general write transformation replaces the gate legacy special mode',()=>{
    const ui=editor({devices:[device('gate','devices.types.openable')],bindings:[cap('gate',{commandId:'gate.cmd',retrievable:false,commandMode:'enum_open_close'})]});
    ui.act('open',0);ui.act('toggle-function',0);
    ui.change({transformRow:'0',transformDirection:'writeTransform'},false,'invert');
    const binding=ui.save().bindings[0];
    assert.equal(binding.commandMode,'direct');
    assert.equal(JSON.parse(binding.writeTransform).type,'invert');
    assert.equal(binding.commandId,'gate.cmd');
});

test('separate feedback old layout remains unchanged unless user edits it',()=>{
    const old=cap('heater',{stateId:'heater.actual',commandId:'heater.set',writeTransform:'{"type":"scale","from":[0,100],"to":[0,1000]}'});
    const ui=editor({devices:[device('heater','devices.types.thermostat')],bindings:[old]});
    ui.act('open',0);ui.act('toggle-function',0);
    assert.match(ui.html(),/Объект обратной связи/);
    assert.match(ui.html(),/heater\.set/);
    assert.match(ui.html(),/heater\.actual/);
    assert.equal(JSON.stringify(ui.save().bindings[0]),JSON.stringify(old));
});

test('selecting OPEN/CLOSE for any on_off function defaults to command-only and does not invent feedback',()=>{
    const ui=editor({devices:[device('gate','devices.types.openable')],bindings:[cap('gate',{stateId:'gate.control'})]});
    ui.act('open',0);ui.act('toggle-function',0);
    ui.change({transformRow:'0',transformDirection:'writeTransform'},false,'enum_open_close');
    const b=ui.save().bindings[0];
    assert.equal(b.commandMode,'enum_open_close');
    assert.equal(b.commandId,'gate.control');
    assert.equal(b.stateId,'');
    assert.equal(b.retrievable,false);
});

test('unified config routes separate read/write to correct ioBroker objects at runtime',async()=>{
    const ui=editor({devices:[device('heater','devices.types.thermostat')],bindings:[cap('heater',{stateId:'heater.actual',commandId:'heater.set'})]});
    const binding=ui.save().bindings[0];
    const writes=[];
    const bridge=new Bridge({oauthUserId:'1',devices:[device('heater','devices.types.thermostat')],bindings:[binding]},
        {getState:async id=>id==='heater.actual'?true:undefined,setState:async(id,value)=>writes.push([id,value])});
    const state=await bridge.query('1',[{id:'heater'}]);
    assert.equal(state[0].capabilities[0].state.value,true);
    const action=await bridge.action('1',[{id:'heater',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]);
    assert.equal(action[0].capabilities[0].state.action_result.status,'DONE');
    assert.deepEqual(writes,[['heater.set',false]]);
});
