'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture({failed=false,missingDialog=false}={}) {
    const nodes=new Map(), events=new Map(), actions=[];
    function node(sel) {
        if (missingDialog && sel==='#state-picker-dialog') return null;
        if(!nodes.has(sel)) nodes.set(sel, {innerHTML:'',textContent:'',value:'',hidden:true,open:false,disabled:false,
            className:'',classList:{toggle(){}},addEventListener(name,fn){events.set(sel+':'+name,fn);},
            showModal(){this.open=true;},close(){this.open=false;},focus(){},setAttribute(){},removeAttribute(){}});
        return nodes.get(sel);
    }
    const states=[
        {id:'zigbee.0.kitchen.on',name:'Лампа',role:'switch',objectType:'state',write:true},
        {id:'zigbee.0.kitchen.online',name:'Доступно',role:'indicator.connected',objectType:'state',write:false}
    ];
    const sandbox={window:{instance:0,sendTo(inst,cmd,data,done){
        actions.push(cmd);
        assert.equal(inst,null);
        if(cmd==='candidates') {if(failed)throw Error('Test candidates error');done(states);}
        else if(cmd==='categories')done({rooms:[],functions:[]});
        else throw Error('Unexpected command: '+cmd);
    }},document:{querySelector:node,querySelectorAll:()=>[],getElementById:id=>node('#'+id),
        addEventListener:(name,cb)=>{const old=events.get(name)||[];old.push(cb);events.set(name,old);}},
        setTimeout:()=>1,clearTimeout:()=>{},console};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin/editor.js'),'utf8'),sandbox);
    sandbox.window.load({oauthUserId:'1',devices:[{id:'lamp',name:'Lamp',type:'devices.types.light',enabled:true,onlineStateId:''}],bindings:[]},()=>{});
    function click(action,path) {const el={dataset:{action,path},tagName:'BUTTON',type:'button'};
        for(const cb of events.get('click')||[])cb({target:{closest:sel=>sel==='[data-action]'?el:null},preventDefault(){}});}
    function select(index) {const el={dataset:{stateIndex:String(index)}};
        for(const cb of events.get('click')||[])cb({target:{closest:sel=>sel==='[data-state-index]'?el:null},preventDefault(){}});}
    return {sandbox,nodes,actions,click,select,events};
}
test('state browser searches adapter candidates, navigates folders and saves selected state ID',()=>{
    const f=fixture();
    f.click('pick-state','devices.0.onlineStateId');
    assert.deepEqual(f.actions,['candidates','categories']);
    assert.equal(f.nodes.get('#state-picker-dialog').open,true);
    const results=f.nodes.get('#state-picker-results');
    assert.match(results.innerHTML,/zigbee/);
    f.select(1);
    let saved;f.sandbox.window.save(d=>{saved=d});
    assert.equal(saved.devices[0].onlineStateId,'zigbee.0.kitchen.online');
    assert.equal(f.nodes.get('#state-picker-dialog').open,false);
    f.click('pick-state','devices.0.onlineStateId');
    assert.equal(f.nodes.get('#state-picker-path').textContent,'zigbee.0.kitchen');
    assert.match(results.innerHTML,/zigbee\.0\.kitchen\.online/);
});
test('cancelling the state picker never changes state, missing dialog reports error',()=>{
    const f=fixture();f.click('pick-state','devices.0.onlineStateId');
    f.nodes.get('#state-picker-dialog').close();
    let saved;f.sandbox.window.save(d=>saved=d);
    assert.equal(saved.devices[0].onlineStateId,'');
    const broken=fixture({missingDialog:true});broken.click('pick-state','devices.0.onlineStateId');
    assert.match(broken.nodes.get('#notice').textContent,/Не найден диалог/);
});
test('state browser renders search matches and safely escapes server object names',()=>{
    const f=fixture();f.click('pick-state','devices.0.onlineStateId');
    const q=f.nodes.get('#state-picker-search');q.value='доступно';
    for(const cb of f.events.get('DOMContentLoaded')||[]) cb();
    f.events.get('#state-picker-search:input')();
    assert.match(f.nodes.get('#state-picker-results').innerHTML,/zigbee\.0\.kitchen\.online/);
    assert.doesNotMatch(f.nodes.get('#state-picker-results').innerHTML,/zigbee\.0\.kitchen\.on"/);
});
test('no Materialize or FancyTree UI assets are loaded in the active Admin tab',()=>{
    const html=fs.readFileSync(path.join(__dirname,'../admin/tab_m.html'),'utf8');
    for(const resource of ['materialize.js','materialize.css','jquery-ui.min.js','jquery.fancytree-all.min.js','selectID.js'])
        assert.ok(!html.includes(resource),resource);
    assert.match(html,/id="state-picker-dialog"/);
    assert.match(html,/tab-controller.js/);
});
