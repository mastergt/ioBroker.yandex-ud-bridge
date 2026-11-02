'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(settings) {
    const nodes = new Map(), events = new Map(), calls = [];
    function node(sel) {
        if (!nodes.has(sel)) nodes.set(sel, {innerHTML:'',textContent:'',hidden:true,className:'',value:'',open:false,showModal(){this.open=true;},close(){this.open=false;},setAttribute(){},removeAttribute(){},focus(){},classList:{toggle(){}}});
        return nodes.get(sel);
    }
    let selectedId;
    const states=[{id:'zigbee.0.hall.relay.on',name:'Hall relay',role:'switch',type:'boolean',write:true,objectType:'state'}];
    const jquery=()=>({selectId(command,...args){
        if (command==='show') selectCallback=args[1];
        return this;
    }});
    jquery.fn={selectId(){}};
    const fullObjects={
        'zigbee.0.hall.relay.on':{type:'state',common:{name:'Hall relay',role:'switch',write:true,type:'boolean'}}
    };
    const categories = {
        rooms:[{id:'enum.rooms.hall',name:'Hall',members:['zigbee.0.hall']},
               {id:'enum.rooms.other',name:'Other',members:['mqtt.0.other']}],
        functions:[{id:'enum.functions.light',name:'Lighting',members:['zigbee.0.hall.relay']}]
    };
    const sandbox={
        window:{instance:0,jQuery:jquery,socket:{emit(name,callback){
            assert.equal(name,'getObjects');callback(null,fullObjects);
        }},sendTo(_instance,cmd,_params,callback){
            calls.push(cmd);
            if(cmd==='candidates')callback(states);
            else if(cmd==='categories')callback(categories);
            else throw Error('Unexpected request: '+cmd);
        }},
        document:{querySelector:node,querySelectorAll:()=>[],getElementById:id=>node('#'+id),
            addEventListener:(name,cb)=>{const list=events.get(name)||[];list.push(cb);events.set(name,list);}},
        setTimeout(){return 1;},clearTimeout(){},console
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),sandbox);
    sandbox.window.load(settings || {oauthUserId:'1',devices:[],bindings:[]},()=>{});
    const click=(action,path,index)=>{
        const button={dataset:{action,path,index},tagName:'BUTTON',type:'button'};
        const e={target:{closest:selector=>selector==='[data-action]'?button:null},preventDefault(){}};
        for(const cb of events.get('click')||[])cb(e);
    };
    const selectRoom=value=>{
        const e={target:{dataset:{action:'room-choice',deviceIndex:'0'},value}};
        for(const cb of events.get('change')||[])cb(e);
    };
    const save=()=>{let result;sandbox.window.save(data=>{result=data});return result;};
    return {calls,click,selectRoom,save,chooseState:id=>{
        const index=states.findIndex(s=>s.id===id); assert.ok(index>=0);
        for(const cb of events.get('click')||[])cb({target:{closest:sel=>sel==='[data-state-index]'?{dataset:{stateIndex:String(index)}}:null},preventDefault(){}});
    },nodes};
}

test('smart add infers room from device membership and type from function category',()=>{
    const f=page();
    assert.deepEqual(f.calls,['candidates','categories']);
    f.click('smart-add');
    f.click('pick-state','smartState');
    f.chooseState('zigbee.0.hall.relay.on');
    f.click('create-state');
    const d=f.save().devices[0];
    assert.equal(d.room,'Hall');
    assert.equal(d.roomEnumId,'enum.rooms.hall');
    assert.equal(d.type,'devices.types.light');
    assert.match(f.nodes.get('#content').innerHTML,/enum.rooms.hall/);
});

test('legacy room is never overwritten when binding an ioBroker state',()=>{
    const f=page({oauthUserId:'1',devices:[{id:'legacy',name:'Legacy',type:'devices.types.light',room:'Old manual room',enabled:true}],bindings:[{deviceId:'legacy',kind:'capability',type:'on_off',instance:'on',enabled:false,stateId:'',commandId:''}]});
    f.click('pick-state','bindings.0.stateId');
    f.chooseState('zigbee.0.hall.relay.on');
    const d=f.save().devices[0];
    assert.equal(d.room,'Old manual room');
    assert.equal(d.roomEnumId,undefined);
    f.selectRoom('enum.rooms.hall');
    assert.equal(f.save().devices[0].room,'Hall');
    const html=f.nodes.get('#room-field').innerHTML;
    assert.doesNotMatch(html,/Ввести вручную|Название комнаты для Яндекса|data-bind="devices\.0\.room"/);
    f.selectRoom('');
    assert.equal(f.save().devices[0].room,'');
    assert.equal(f.save().devices[0].roomEnumId,'');
});

test('explicit no-room choice is not overwritten by later automatic suggestions',()=>{
    const f=page({oauthUserId:'1',devices:[{id:'dev',name:'Lamp',type:'devices.types.light',room:'',enabled:true}],bindings:[{deviceId:'dev',kind:'capability',type:'on_off',instance:'on',enabled:false,stateId:'',commandId:''}]});
    f.selectRoom('');
    f.click('pick-state','bindings.0.stateId');
    f.chooseState('zigbee.0.hall.relay.on');
    assert.equal(f.save().devices[0].room,'');
    assert.equal(f.save().devices[0].roomManual,true);
});

test('existing room label matching an ioBroker category uses the same dropdown and migrates ID on save',()=>{
    const f=page({oauthUserId:'1',devices:[{id:'kitchen',name:'Lamp',type:'devices.types.light',room:' hall ',enabled:true}],bindings:[]});
    f.click('open',null,'0');
    const html=f.nodes.get('#content').innerHTML;
    assert.match(html,/<option value="enum\.rooms\.hall" selected>Hall<\/option>/);
    assert.doesNotMatch(html,/Ввести вручную|Название комнаты для Яндекса|data-bind="devices\.0\.room"/);
    assert.equal((html.match(/<select data-action="room-choice"/g)||[]).length,1);
    const d=f.save().devices[0];
    assert.equal(d.room,'Hall');
    assert.equal(d.roomEnumId,'enum.rooms.hall');
});

test('unmatched imported room remains selectable as legacy option, never lost automatically',()=>{
    const f=page({oauthUserId:'1',devices:[{id:'old',name:'Old light',type:'devices.types.light',room:'Кухня (старая)',enabled:true}],bindings:[]});
    f.click('open',null,'0');
    const html=f.nodes.get('#content').innerHTML;
    assert.match(html,/Кухня \(старая\) \(сохранено ранее\)/);
    assert.match(html,/<option value="__legacy__" selected>/);
    assert.doesNotMatch(html,/<input[^>]*data-bind="devices\.0\.room"|Ввести вручную/);
    assert.equal(f.save().devices[0].room,'Кухня (старая)');
    f.selectRoom('enum.rooms.other');
    assert.equal(f.save().devices[0].room,'Other');
});

test('display name follows the selected category even after room rename',()=>{
    const f=page({oauthUserId:'1',devices:[{id:'lamp',name:'Lamp',type:'devices.types.light',room:'Original name',roomEnumId:'enum.rooms.hall',enabled:true}],bindings:[]});
    f.click('open',null,'0');
    assert.match(f.nodes.get('#content').innerHTML,/<option value="enum\.rooms\.hall" selected>Hall<\/option>/);
    assert.equal(f.save().devices[0].room,'Hall');
});
