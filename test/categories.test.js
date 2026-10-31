'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { objectBelongsToEnum, matchingEnums, simplifyEnums } = require('../lib/categories');

test('ioBroker rooms and functions keep localized names and hierarchical memberships', () => {
    const rooms = simplifyEnums({
        'enum.rooms.hall': {type:'enum',common:{name:{ru:'\u041f\u0430\u0440\u0430\u0434\u043d\u0430\u044f',en:'Hall'},members:['zigbee.0.hall','zigbee.0.hall']}},
        'enum.rooms.kitchen': {type:'enum',common:{name:'Kitchen',members:['zigbee.0.kitchen.light.on']}},
        'enum.functions.other': {type:'enum',common:{name:'Invalid prefix',members:['zigbee.0.hall']}}
    }, 'enum.rooms');
    assert.equal(rooms.length, 2);
    assert.equal(rooms.find(r=>r.id==='enum.rooms.hall').name,'\u041f\u0430\u0440\u0430\u0434\u043d\u0430\u044f');
    assert.deepEqual(rooms.find(r=>r.id==='enum.rooms.hall').members,['zigbee.0.hall']);
    assert.equal(matchingEnums('zigbee.0.hall.switch.on', rooms)[0].id,'enum.rooms.hall');
    assert.deepEqual(matchingEnums('zigbee.0.hall2.switch.on',rooms),[]);
    assert.equal(objectBelongsToEnum('mqtt.0.device.level','mqtt.0.device'),true);
    assert.equal(objectBelongsToEnum('mqtt.0.device2.level','mqtt.0.device'),false);
});

test('handles missing/invalid categories without reading undeclared object types',()=>{
    assert.deepEqual(simplifyEnums({
        'enum.rooms.bad': {type:'state',common:{name:'Ignore'}},
        'enum.rooms.empty': {type:'enum',common:{name:{de:'Flur'},members:null}}
    },'enum.rooms'),[{id:'enum.rooms.empty',name:'Flur',members:[]}]);
});
