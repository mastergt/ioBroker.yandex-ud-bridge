'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture({ failObjects=false, hasNative=true }={}) {
    const nodes=new Map(), events=new Map(), actions=[], nativeCalls=[];
    function node(sel){
        if(!nodes.has(sel)) nodes.set(sel,{innerHTML:'',textContent:'',hidden:true,className:'',value:'',
            classList:{toggle(){}}});
        return nodes.get(sel);
    }
    const states=[
        {id:'zigbee.0.kitchen.on',name:'Лампа',role:'switch',objectType:'state',write:true},
        {id:'zigbee.0.kitchen.online',name:'Доступно',role:'indicator.connected',objectType:'state',write:false}
    ];
    const fullObjects={
        'zigbee.0.kitchen.on': {_id:'zigbee.0.kitchen.on',type:'state',common:{name:'Лампа',role:'switch',write:true}},
        'zigbee.0.kitchen.online': {_id:'zigbee.0.kitchen.online',type:'state',common:{name:'Доступно',role:'indicator.connected',write:false}}
    };
    let selectResult;
    const jquery=sel=>{
        assert.equal(sel,'#dialog-select-member');
        return {
            selectId(cmd,...args){
                nativeCalls.push([cmd,...args]);
                if(cmd==='init') { selectResult=this; return this; }
                if(cmd==='show') return undefined;
                throw Error('invalid command');
            }
        };
    };
    jquery.fn={};
    if(hasNative)jquery.fn.selectId=()=>{};
    const sandbox={
        window:{instance:0,jQuery:jquery,
            socket:{emit(cmd,done){
                assert.equal(cmd,'getObjects');actions.push('getObjects');
                done(failObjects?'Admin test error':null,failObjects?null:fullObjects);
            }},
            sendTo(inst,cmd,data,done){
                actions.push(cmd);
                assert.equal(inst,null);
                if(cmd==='candidates')done(states);
                else if(cmd==='categories')done({rooms:[],functions:[]});
                else throw Error('unexpected '+cmd);
            }
        },
        document:{querySelector:node,querySelectorAll:()=>[],getElementById:id=>node('#'+id),
            addEventListener:(name,cb)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(cb);}},
        setTimeout:(fn,delay)=>({fn,delay}),clearTimeout:()=>{},
        console
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),sandbox);
    const device={id:'lamp',name:'Лампа',type:'devices.types.light',enabled:true,onlineStateId:''};
    sandbox.window.load({oauthUserId:'1',devices:[device],bindings:[]},()=>{});
    const click=(action,prop)=>{
        const el={dataset:{action,path:prop},tagName:'BUTTON',type:'button',classList:{contains:()=>false}};
        const evt={target:{closest:sel=>sel==='[data-action]'?el:null},preventDefault(){}};
        for(const cb of events.get('click')||[]) cb(evt);
    };
    return {sandbox,nodes,actions,nativeCalls,click,fullObjects,getCallback:()=>nativeCalls.filter(x=>x[0]==='show').at(-1)?.[2],getDevice:()=>device};
}
test('Native ioBroker dialog uses complete Admin objects, filters states, preserves selected ID',()=>{
    const f=fixture();
    f.click('pick-state','devices.0.onlineStateId');
    assert.deepEqual(f.actions,['candidates','categories','getObjects']);
    assert.equal(f.nativeCalls[0][0],'init');
    assert.equal(f.nativeCalls[0][1].objects,f.fullObjects);
    assert.equal(f.nativeCalls[0][1].filter.type,'state');
    assert.equal(f.nativeCalls[0][1].noMultiselect,true);
    assert.deepEqual(f.nativeCalls[1].slice(0,2),['show','']);
    f.getCallback()('zigbee.0.kitchen.online');
    let saved;f.sandbox.window.save(d=>{saved=d});
    assert.equal(saved.devices[0].onlineStateId,'zigbee.0.kitchen.online');
    f.click('pick-state','devices.0.onlineStateId');
    assert.equal(f.actions.filter(x=>x==='getObjects').length,1);
    assert.equal(f.nativeCalls.at(-1)[1],'zigbee.0.kitchen.online');
});
test('Cancel does not alter value, and missing native component displays useful error',()=>{
    const f=fixture();
    f.click('pick-state','devices.0.onlineStateId');
    f.getCallback()(undefined);
    let saved;f.sandbox.window.save(d=>saved=d);
    assert.equal(saved.devices[0].onlineStateId,'');
    const broken=fixture({hasNative:false});
    broken.click('pick-state','devices.0.onlineStateId');
    assert.match(broken.nodes.get('#notice').textContent,/selectID.js/);
});
test('Failed Admin getObjects reports an error instead of opening an empty modal',()=>{
    const f=fixture({failObjects:true});
    f.click('pick-state','devices.0.onlineStateId');
    assert.equal(f.nativeCalls.length,0);
    assert.match(f.nodes.get('#notice').textContent,/Admin test error/);
});
test('Materialize page includes native selectID and required FancyTree dependencies',()=>{
    const html=fs.readFileSync(path.join(__dirname,'../admin/index_m.html'),'utf8');
    for(const resource of ['jquery-ui.min.js','jquery.fancytree-all.min.js','ui.fancytree.min.css','selectID.js'])assert.match(html,new RegExp(resource.replaceAll('.','\\.')));
    assert.match(html,/id="dialog-select-member"/);
    assert.doesNotMatch(html,/state-modal-host/);
});
