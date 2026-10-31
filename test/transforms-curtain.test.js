'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Bridge,toYandex,fromYandex}=require('../lib/bridge');
const {validateTransform,applyTransform}=require('../lib/transforms');
const {validatedChange,revision}=require('../lib/tab-config');

const prefix='tuya.0.bf0curtain';
const stateId=prefix+'.2';
const threshold=JSON.stringify({type:'threshold',operator:'lt',value:100});
const lookup=JSON.stringify({type:'lookup',pairs:[[true,0],[false,100]]});
const invert=JSON.stringify({type:'invert',max:100});
function fixture(){
 const states=new Map([[stateId,100],[prefix+'.online',true]]);
 const writes=[];
 const devices=[{id:'IOBR_curtain',name:'Шторы',enabled:true,type:'devices.types.openable.curtain',onlineStateId:prefix+'.online'}];
 const bindings=[
  {enabled:true,deviceId:'IOBR_curtain',kind:'capability',type:'on_off',instance:'on',retrievable:true,
   stateId,commandId:stateId,readTransform:threshold,writeTransform:lookup},
  {enabled:true,deviceId:'IOBR_curtain',kind:'capability',type:'range',instance:'open',retrievable:true,
   stateId,commandId:stateId,readTransform:invert,writeTransform:invert,
   parameters:JSON.stringify({instance:'open',unit:'unit.percent',random_access:true,range:{min:0,max:100,precision:1}})}
 ];
 const reads=[];
 const b=new Bridge({oauthUserId:'1',devices,bindings},{getState:async id=>{reads.push(id);return states.get(id);},setState:async (id,v)=>writes.push([id,v])});
 return {b,states,writes,reads,devices,bindings};
}
const makeAction=(type,instance,value)=>({id:'IOBR_curtain',capabilities:[{type:`devices.capabilities.${type}`,state:{instance,value}}]});

test('Tuya curtain on_off uses ONLY .2: 0 open, 100 closed; QUERY always uses same state',async()=>{
 const {b,states,writes,reads}=fixture();
 const definition=b.discover('1')[0];
 assert.deepEqual(definition.capabilities.map(c=>c.type),['devices.capabilities.on_off','devices.capabilities.range']);
 assert.deepEqual(definition.capabilities[1].parameters.range,{min:0,max:100,precision:1});
 let response=await b.query('1',[{id:'IOBR_curtain'}]);
 assert.deepEqual(response[0].capabilities.map(c=>c.state.value),[false,0]);
 for (const [actual, expectedBool, expectedOpen] of [[0,true,100],[25,true,75],[50,true,50],[75,true,25],[99,true,1],[100,false,0]]) {
   states.set(stateId,actual);
   response=await b.query('1',[{id:'IOBR_curtain'}]);
   assert.deepEqual(response[0].capabilities.map(c=>c.state.value),[expectedBool,expectedOpen]);
 }
 assert.equal((await b.action('1',[makeAction('on_off','on',true)]))[0].capabilities[0].state.action_result.status,'DONE');
 assert.deepEqual(writes.at(-1),[stateId,0]);
 assert.equal((await b.action('1',[makeAction('on_off','on',false)]))[0].capabilities[0].state.action_result.status,'DONE');
 assert.deepEqual(writes.at(-1),[stateId,100]);
 assert.ok(!reads.includes(prefix+'.1') && !reads.includes(prefix+'.3'));
 assert.ok(writes.every(w=>w[0]===stateId));
});

test('Tuya curtain range inverts both directions and never accesses .1 or .3',async()=>{
 const {b,writes,states}=fixture();
 for (const [percent,local] of [[0,100],[25,75],[50,50],[75,25],[100,0]]) {
   const result=await b.action('1',[makeAction('range','open',percent)]);
   assert.equal(result[0].capabilities[0].state.action_result.status,'DONE');
   assert.deepEqual(writes.at(-1),[stateId,local]);
   states.set(stateId,local);
   assert.equal((await b.query('1',[{id:'IOBR_curtain'}]))[0].capabilities[1].state.value,percent);
 }
 const result=await b.action('1',[makeAction('range','open',110)]);
 assert.equal(result[0].capabilities[0].state.action_result.status,'ERROR');
 assert.equal(writes.length,5);
});

test('state notifications transform both values from same percent_control; offline disables actions',async()=>{
 const {b,states,writes}=fixture();
 b.bindingsOf('IOBR_curtain').forEach(r=>r.reportable=true);
 const changed=await b.onStateChange(stateId,60);
 assert.deepEqual(changed[0].capabilities.map(c=>c.state.value),[true,40]);
 states.set(prefix+'.online',false);
 assert.equal((await b.query('1',[{id:'IOBR_curtain'}]))[0].error_code,'DEVICE_UNREACHABLE');
 const result=await b.action('1',[makeAction('on_off','on',true)]);
 assert.equal(result[0].action_result.error_code,'DEVICE_UNREACHABLE');
 assert.deepEqual(writes,[]);
});

test('transform types are independent; legacy mapping remains unchanged',()=>{
 assert.equal(applyTransform(70,{type:'invert',max:100}),30);
 assert.equal(applyTransform(50,{type:'scale',from:[0,100],to:[0,1000]}),500);
 assert.equal(applyTransform('1',{type:'boolean'}),true);
 assert.equal(applyTransform('off',{type:'boolean'}),false);
 assert.equal(applyTransform('unknown',{type:'boolean'}),undefined);
 assert.equal(applyTransform(0,{type:'threshold',operator:'lt',value:100}),true);
 assert.equal(applyTransform(100,{type:'threshold',operator:'lt',value:100}),false);
 assert.equal(fromYandex(true,{type:'on_off',mapping:'',writeTransform:lookup}),0);
 assert.equal(fromYandex(false,{type:'on_off',mapping:'',writeTransform:lookup}),100);
 assert.equal(toYandex(0,{type:'on_off',mapping:'',readTransform:threshold}),true);
 assert.equal(toYandex(100,{type:'on_off',mapping:'',readTransform:threshold}),false);
 assert.equal(toYandex(undefined,{type:'on_off'}),undefined);
 assert.equal(toYandex('off',{type:'on_off'}),false);
 const oldMapping=JSON.stringify([[false,true],[0,1]]);
 assert.equal(fromYandex(true,{mapping:oldMapping}),1);
 assert.equal(toYandex(0,{type:'on_off',mapping:oldMapping}),false);
 assert.equal(toYandex(1,{type:'range',readTransform:JSON.stringify({type:'scale',from:[0,1],to:[0,100]})}),100);
});

test('invalid transforms are rejected without writing to ioBroker',async()=>{
 assert.throws(()=>validateTransform('{bad'),/JSON/);
 assert.throws(()=>validateTransform('{"type":"scale","from":[0,0],"to":[0,100]}'),/диапазон/);
 assert.throws(()=>validateTransform('{"type":"eval","source":"alert(1)"}'),/Неизвестный тип/);
 assert.throws(()=>applyTransform(true,{type:'lookup',pairs:[[false,100]]}),/Нет соответствия/);
 const {b,writes}=fixture();
 b.bindingsOf('IOBR_curtain')[0].writeTransform=JSON.stringify({type:'lookup',pairs:[[false,100]]});
 const resp=await b.action('1',[makeAction('on_off','on',true)]);
 assert.equal(resp[0].capabilities[0].state.action_result.status,'ERROR');
 assert.deepEqual(writes,[]);
 const native={devices:[{id:'IOBR_curtain'}],bindings:[{deviceId:'IOBR_curtain',readTransform:'{"type":"eval"}'}]};
 assert.throws(()=>validatedChange({...native,revision:revision(native)},revision(native)),/Неверное преобразование/);
});

test('UI Tuya preset preserves on_off and range, zero means open, preserves unrelated data',()=>{
 const elements=new Map(),listeners={};
 function elem(id) {if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',hidden:false,className:'',classList:{toggle(){}},value:''});return elements.get(id);}
 const doc={documentElement:{dataset:{bridgeMode:'tab'}},body:{dataset:{bridgeMode:'tab'}},querySelector(sel){return elem(sel);},querySelectorAll(){return [];},addEventListener(name,handler){(listeners[name]||=[]).push(handler);}};
 const win={instance:0,confirm:()=>true,bridgeTabSend(command,params,done){if(command==='candidates') done(['2','online'].map(s=>({id:`${prefix}.${s}`,objectType:'state',write:true})));else if(command==='categories')done({rooms:[],functions:[]});else done({});}};
 const sandbox={document:doc,window:win,setTimeout,clearTimeout,console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),sandbox);
 const cfg={oauthClientSecret:'SECRET',devices:[{id:'curtain',name:'Зал',type:'devices.types.openable.curtain',enabled:true},{id:'light',name:'Лампа',enabled:true,type:'devices.types.light'}],bindings:[
  {deviceId:'curtain',kind:'capability',type:'on_off',instance:'on',commandId:prefix+'.1',stateId:'old.state',enabled:true},
  {deviceId:'light',kind:'capability',type:'on_off',instance:'on',stateId:'light.on',enabled:true}
 ]};
 win.load(cfg,()=>{});
 function action(name,index){const el={dataset:{action:name,index:String(index??'')},tagName:'BUTTON',closest(selector){return selector==='[data-action]'?this:null;}};for(const cb of listeners.click||[])cb({target:el,preventDefault(){}});}
 action('open',0);
 assert.match(elem('#content').innerHTML,/Шторы Tuya · простая настройка/);
 assert.match(elem('#content').innerHTML,/percent_control/);
 action('apply-tuya-curtain');
 let saved;
 win.save(x=>saved=x);
 assert.equal(saved.devices.length,2);
 assert.equal(saved.devices[0].id,'curtain');
 assert.equal(saved.oauthClientSecret,'SECRET');
 assert.equal(saved.devices[0].onlineStateId,prefix+'.online');
 assert.equal(saved.bindings.filter(b=>b.deviceId==='curtain').length,2);
 const range=saved.bindings.find(b=>b.deviceId==='curtain'&&b.type==='range');
 assert.equal(range.stateId,stateId);assert.equal(range.commandId,stateId);
 assert.equal(fromYandex(0,range),100);assert.equal(toYandex(100,range),0);
 assert.equal(fromYandex(70,range),30);assert.equal(toYandex(20,range),80);
 const onOff=saved.bindings.find(b=>b.deviceId==='curtain'&&b.type==='on_off');
 assert.equal(onOff.stateId,stateId);assert.equal(onOff.commandId,stateId);
 assert.equal(fromYandex(false,onOff),100);assert.equal(fromYandex(true,onOff),0);
 assert.equal(toYandex(0,onOff),true);assert.equal(toYandex(100,onOff),false);
 assert.equal(saved.bindings.find(b=>b.deviceId==='light').stateId,'light.on');
 action('apply-tuya-curtain');win.save(x=>saved=x);
 assert.equal(saved.bindings.filter(b=>b.deviceId==='curtain').length,2);
});
