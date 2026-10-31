'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Bridge,fromYandex,toYandex}=require('../lib/bridge');

function env(config){
    const elements=new Map(),listeners={};
    function element(id){if(!elements.has(id))elements.set(id,{
        innerHTML:'',textContent:'',hidden:false,className:'',classList:{toggle(){}},value:'',
        focus(){},setSelectionRange(){}
    });return elements.get(id);}
    const document={documentElement:{dataset:{bridgeMode:'tab'}},body:{dataset:{bridgeMode:'tab'}},
        querySelector:element,querySelectorAll(){return [];},addEventListener(event,callback){(listeners[event]||=[]).push(callback);}};
    const window={confirm:()=>true,instance:0,bridgeTabSend(command,params,cb){
        if(command==='candidates')cb([]);else if(command==='categories')cb({rooms:[],functions:[]});else cb({});
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),{
        document,window,setTimeout,clearTimeout,console
    });
    window.load(config,()=>{});
    function fire(event, dataset, value, tagName='INPUT', extra={}){
        const target={dataset,value,type:tagName==='INPUT'?'text':undefined,tagName,checked:false,
            closest(selector){
                if(selector==='[data-action]')return dataset.action!==undefined?this:null;
                if(selector.includes('data-transform-add'))return dataset.transformAdd!==undefined||dataset.transformRemove!==undefined||dataset.transformMirror!==undefined?this:null;
                return null;
            },...extra};
        for(const fn of listeners[event]||[])fn({target,preventDefault(){}});
    }
    const action=(a,i)=>fire('click',{action:a,index:String(i)},'','BUTTON');
    const save=()=>{let result;window.save(x=>result=JSON.parse(JSON.stringify(x)));return result;};
    return {fire,action,save,html:()=>element('#content').innerHTML};
}
const binding=(extra={})=>({deviceId:'gate',kind:'capability',type:'on_off',instance:'on',enabled:true,
    retrievable:true,reportable:false,stateId:'zigbee.0.gate.position',commandId:'zigbee.0.gate.position',
    parameters:'',mapping:'',readTransform:'',writeTransform:'',...extra});
const config=b=>({devices:[{id:'gate',name:'Гараж',type:'devices.types.openable',enabled:true}],bindings:[b]});

test('0.3.14 editable table converts Yandex Boolean to ioBroker numeric and read threshold without JSON',async()=>{
    const ui=env(config(binding({commandMode:'enum_open_close',openValue:'OPEN',closeValue:'CLOSE'})));
    ui.action('open',0);ui.action('toggle-function',0);
    ui.fire('change',{transformRow:'0',transformDirection:'writeTransform'},'lookup','SELECT');
    assert.match(ui.html(),/Таблица соответствий/);
    assert.doesNotMatch(ui.html(),/Параметры преобразования \(JSON\)/);
    for(const [index,yes,local] of [[0,'true','100'],[1,'false','0']]){
        ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:String(index),mapSide:'0'},yes);
        ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:String(index),mapSide:'1'},local);
    }
    ui.fire('change',{transformRow:'0',transformDirection:'readTransform'},'threshold','SELECT');
    const b=ui.save().bindings[0];
    assert.equal(b.commandMode,'direct');
    assert.deepEqual(JSON.parse(b.writeTransform),{type:'lookup',pairs:[[true,100],[false,0]]});
    assert.deepEqual(JSON.parse(b.readTransform),{type:'threshold',operator:'gt',value:0});
    assert.equal(fromYandex(false,b),0);
    assert.equal(fromYandex(true,b),100);
    assert.equal(toYandex(35,b),true);
    const writes=[];
    const bridge=new Bridge({oauthUserId:'1',devices:config(b).devices,bindings:[b]},
        {getState:async()=>0,setState:async(id,v)=>writes.push([id,v])});
    const res=await bridge.action('1',[{id:'gate',capabilities:[{type:'devices.capabilities.on_off',state:{instance:'on',value:false}}]}]);
    assert.equal(res[0].capabilities[0].state.action_result.status,'DONE');
    assert.deepEqual(writes,[['zigbee.0.gate.position',0]]);
});

test('lookup entries automatically parse numbers but leave OPEN/CLOSE and other words strings',()=>{
    const ui=env(config(binding()));ui.action('open',0);ui.action('toggle-function',0);
    ui.fire('change',{transformRow:'0',transformDirection:'writeTransform'},'lookup','SELECT');
    ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:'0',mapSide:'0'},'true');
    ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:'0',mapSide:'1'},'OPEN');
    ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:'1',mapSide:'0'},'false');
    ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:'1',mapSide:'1'},'-2.5');
    assert.deepEqual(JSON.parse(ui.save().bindings[0].writeTransform).pairs,[[true,'OPEN'],[false,-2.5]]);
});

test('reverse table button copies typed pairs and preserves both sides',()=>{
    const ui=env(config(binding()));ui.action('open',0);ui.action('toggle-function',0);
    ui.fire('change',{transformRow:'0',transformDirection:'writeTransform'},'lookup','SELECT');
    for(const [i,a,b] of [[0,'true','100'],[1,'false','0']]){
        ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:String(i),mapSide:'0'},a);
        ui.fire('input',{mapRow:'0',mapDirection:'writeTransform',mapIndex:String(i),mapSide:'1'},b);
    }
    ui.fire('click',{transformMirror:'0',transformDirection:'writeTransform'},'','BUTTON');
    const b=ui.save().bindings[0];
    assert.deepEqual(JSON.parse(b.readTransform).pairs,[[100,true],[0,false]]);
});

test('incomplete lookup mapping does not save and legacy transforms remain editable',()=>{
    const ui=env(config(binding({writeTransform:JSON.stringify({type:'lookup',pairs:[[true,100],[false,0]]}),readTransform:JSON.stringify({type:'threshold',operator:'lt',value:99})})));
    ui.action('open',0);ui.action('toggle-function',0);
    assert.match(ui.html(),/Значение порога/);
    assert.match(ui.html(),/100/);
    assert.ok(ui.save());
    ui.fire('change',{transformRow:'0',transformDirection:'writeTransform'},'lookup','SELECT');
    assert.equal(ui.save(),undefined);
});

test('legacy OPEN/CLOSE command entries convert numeric-looking strings into number; text stays text',()=>{
    const row={type:'on_off',commandMode:'enum_open_close',openValue:'100',closeValue:'0'};
    assert.equal(fromYandex(true,row),100);
    assert.equal(fromYandex(false,row),0);
    row.openValue='OPEN';row.closeValue='CLOSE';
    assert.equal(fromYandex(true,row),'OPEN');
    assert.equal(fromYandex(false,row),'CLOSE');
});
