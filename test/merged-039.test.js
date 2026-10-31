'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { Bridge, fromYandex, toYandex } = require('../lib/bridge');

const gate = { deviceId:'gate',enabled:true,kind:'capability',type:'on_off',instance:'on',commandId:'tuya.0.gate.command',commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE',retrievable:false };
const stop = { deviceId:'gate',enabled:true,kind:'capability',type:'toggle',instance:'pause',commandId:'tuya.0.gate.command',commandMode:'stop_only',stopValue:'STOP',retrievable:false };
const curtain = { deviceId:'curtain',enabled:true,kind:'capability',type:'range',instance:'open',stateId:'tuya.0.curtain.percent_control',commandId:'tuya.0.curtain.percent_control',readTransform:JSON.stringify({type:'invert',max:100}),writeTransform:JSON.stringify({type:'invert',max:100}),parameters:JSON.stringify({instance:'open',unit:'unit.percent',range:{min:0,max:100,precision:1}}) };

test('0.3.9 combines gate commands and curtain transforms without overwriting either',async()=>{
  const values = new Map([['tuya.0.curtain.percent_control',0]]),writes=[];
  const bridge = new Bridge({oauthUserId:'1',devices:[{id:'gate',type:'devices.types.openable',name:'Ворота'}, {id:'curtain',type:'devices.types.openable.curtain',name:'Шторы'}],bindings:[gate,stop,curtain]},
    {getState:async id=>values.get(id),setState:async(id,value)=>writes.push([id,value])});
  assert.deepEqual(bridge.discover('1').map(d=>d.type),['devices.types.openable','devices.types.openable.curtain']);
  assert.equal((await bridge.query('1',[{id:'curtain'}]))[0].capabilities[0].state.value,100);
  assert.equal((await bridge.query('1',[{id:'gate'}]))[0].error_code,undefined);
  const go=async(id,type,instance,value)=>bridge.action('1',[{id,capabilities:[{type:`devices.capabilities.${type}`,state:{instance,value}}]}]);
  for (const value of [true,false]) assert.equal((await go('gate','on_off','on',value))[0].capabilities[0].state.action_result.status,'DONE');
  assert.equal((await go('gate','toggle','pause',true))[0].capabilities[0].state.action_result.status,'DONE');
  assert.equal((await go('curtain','range','open',30))[0].capabilities[0].state.action_result.status,'DONE');
  assert.deepEqual(writes,[['tuya.0.gate.command','OPEN'],['tuya.0.gate.command','CLOSE'],['tuya.0.gate.command','STOP'],['tuya.0.curtain.percent_control',70]]);
  assert.equal(toYandex('STOP',gate),undefined);
  assert.equal(fromYandex(90,curtain),10);
});

test('0.3.11 admin keeps gate commands within unified UI, Tuya preset and independent transforms',()=>{
  const els=new Map(),listeners={};
  function el(id){if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',hidden:false,className:'',classList:{toggle(){}},value:'',focus(){},setSelectionRange(){}});return els.get(id);}
  const doc={documentElement:{dataset:{bridgeMode:'tab'}},body:{dataset:{bridgeMode:'tab'}},querySelector:el,querySelectorAll(){return [];},addEventListener(name,cb){(listeners[name]||=[]).push(cb);}};
  const win={instance:0,confirm:()=>true,bridgeTabSend(command,params,done){if(command==='candidates')done([]);else if(command==='categories')done({rooms:[],functions:[]});else done({});}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),{document:doc,window:win,setTimeout,clearTimeout,console});
  const config={oauthClientId:'same-client',oauthClientSecret:'same-secret',devices:[{id:'curtain',name:'Зал',type:'devices.types.openable.curtain',enabled:true,room:'Зал'},{id:'gate',name:'Ворота гаража',type:'devices.types.openable',enabled:true,room:'Улица'}],bindings:[{...curtain},{...gate},{...stop}]};
  win.load(config,()=>{});
  const action=(name,index)=>{const element={dataset:{action:name,index:String(index??'')},tagName:'BUTTON',closest(selector){return selector==='[data-action]'?this:null;}};(listeners.click||[]).forEach(cb=>cb({target:element,preventDefault(){}}));};
  action('open',0);
  assert.match(el('#content').innerHTML,/Шторы Tuya · простая настройка/);
  assert.match(el('#content').innerHTML,/percent_control/);
  action('back'); action('open',1); action('toggle-function',1);
  assert.match(el('#content').innerHTML,/Основной объект ioBroker/);
  assert.match(el('#content').innerHTML,/Читать состояние из отдельного объекта/);
  assert.match(el('#content').innerHTML,/Команды OPEN \/ CLOSE/);
  assert.match(el('#content').innerHTML,/readTransform|Чтение: ioBroker → Яндекс/);
  assert.match(el('#content').innerHTML,/writeTransform|Запись: Яндекс → ioBroker/);
  assert.match(el('#content').innerHTML,/>Открыть</);
  action('toggle-function',2);
  assert.match(el('#content').innerHTML,/Команда STOP при включении/);
  let saved;win.save(data=>{saved=data;});
  assert.equal(saved.oauthClientId,'same-client');
  assert.equal(saved.oauthClientSecret,'same-secret');
  assert.equal(saved.bindings.find(x=>x.deviceId==='curtain').readTransform,curtain.readTransform);
  assert.equal(saved.bindings.find(x=>x.deviceId==='gate'&&x.type==='on_off').commandMode,'enum_open_close');
});
