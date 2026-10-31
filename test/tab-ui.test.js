'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('standalone sidebar loads, tracks changes and saves just two native arrays',()=>{
    const listeners=new Map();
    const elements=new Map();
    const scripts=[];
    const response={devices:[{id:'light',name:'Лампа',enabled:true}],bindings:[],oauthUserId:'1',revision:'rev0'};
    function elem(id){if(!elements.has(id))elements.set(id,{disabled:false,textContent:'',className:'',addEventListener(name,cb){listeners.set(id+':'+name,cb);}});return elements.get(id);}
    const socket={emit(action,instance,cmd,message,cb){
        assert.equal(action,'sendTo');assert.equal(instance,'yandex-ud-bridge.0');
        scripts.push([cmd,message]);
        if(cmd==='getTabConfig')cb(response);
        else if(cmd==='saveTabConfig'){ assert.equal(message.revision,'rev0');cb({ok:true,revision:'rev1'}); }
    }};
    const win={socket,location:{search:'?instance=0'},setTimeout:fn=>1,addEventListener(){},confirm:()=>true};
    const sandbox={window:win,document:{getElementById:elem,addEventListener:(name,cb)=>listeners.set(name,cb)},URLSearchParams,clearTimeout(){},console};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../admin/tab-controller.js'),'utf8'),sandbox);
    win.load=(data,onChange)=>{assert.equal(data.devices[0].id,'light');assert.equal(data.oauthClientSecret,undefined);onChange(false);win.onChange=onChange;};
    win.save=cb=>cb({devices:[{id:'light',name:'Лампа в коридоре'}],bindings:[],oauthPassword:'NEVER-SAVE'});
    listeners.get('DOMContentLoaded')();
    assert.deepEqual(scripts.map(x=>x[0]),['getTabConfig']);
    win.onChange();
    assert.match(elem('tab-save-state').textContent,/несохранённые/);
    listeners.get('tab-save:click')();
    assert.deepEqual(scripts.map(x=>x[0]),['getTabConfig','saveTabConfig']);
    assert.equal(scripts[1][1].oauthPassword,undefined);
    assert.equal(elem('tab-save-state').className,'saved');
});
