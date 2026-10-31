'use strict';
/* The ioBroker Admin invokes window.load(settings,onChange) and window.save(callback).
   All configuration is staged locally and saved only through Admin's Save button. */
(() => {
    const typeNames = {
        'devices.types.light':['Лампа','💡'], 'devices.types.socket':['Розетка','🔌'],
        'devices.types.switch':['Выключатель','⏻'], 'devices.types.sensor':['Датчик','◉'],
        'devices.types.sensor.open':['Датчик открытия','🚪'], 'devices.types.sensor.motion':['Движение','◉'],
        'devices.types.openable':['Ворота','🚪'], 'devices.types.openable.curtain':['Шторы','▤'], 'devices.types.vacuum_cleaner':['Пылесос','◌'],
        'devices.types.camera':['Камера','▣'], 'devices.types.thermostat':['Термостат','🌡'],
        'devices.types.air_conditioner':['Кондиционер','❄'], 'devices.types.fan':['Вентилятор','◉'],
        'devices.types.humidifier':['Увлажнитель','◈'], 'devices.types.kettle':['Чайник','♨'],
        'devices.types.media_device.tv':['ТВ','▣'], 'devices.types.other':['Другое','⌂']
    };
    const available = [
        ['capability','on_off','on','Включение / выключение'],
        ['capability','range','brightness','Яркость'], ['capability','range','open','Положение штор'],
        ['capability','range','temperature','Заданная температура'], ['capability','mode','work_speed','Режим работы'],
        ['capability','toggle','pause','Пауза'], ['capability','color_setting','temperature_k','Цветовая температура'],
        ['capability','color_setting','hsv','Цвет (HSV)'], ['capability','video_stream','get_stream','Видеопоток'],
        ['property','float','temperature','Температура'], ['property','float','humidity','Влажность'],
        ['property','float','battery_level','Заряд батареи'], ['property','float','pressure','Давление'],
        ['property','event','open','Открытие / закрытие'], ['property','event','motion','Движение'],
        ['property','event','water_leak','Протечка'], ['property','event','smoke','Дым'],
        // Virtual editor item: availability is a device-level Yandex status, not a Yandex property.
        ['system','online','available','Доступность']
    ];
    const defaults = {
        'brightness':{instance:'brightness',unit:'unit.percent',range:{min:0,max:100,precision:1}},
        'open':{instance:'open',unit:'unit.percent',range:{min:0,max:100,precision:1}},
        'temperature':{instance:'temperature',unit:'unit.temperature.celsius',range:{min:5,max:40,precision:0.5}},
        'work_speed':{instance:'work_speed',modes:[{value:'auto'},{value:'low'},{value:'medium'},{value:'high'}]},
        'humidity':{instance:'humidity',unit:'unit.percent'}, 'battery_level':{instance:'battery_level',unit:'unit.percent'},
        'pressure':{instance:'pressure',unit:'unit.pressure.mmhg'},
        'motion':{instance:'motion',events:[{value:'detected'},{value:'not_detected'}]},
        'water_leak':{instance:'water_leak',events:[{value:'dry'},{value:'leak'}]},
        'smoke':{instance:'smoke',events:[{value:'detected'},{value:'not_detected'}]},
        'on': {}, 'pause':{instance:'pause'},'get_stream':{protocols:['hls']},'temperature_k':{temperature_k:{min:2700,max:6500}},'hsv':{color_model:'hsv'}
    };
    const templates = [
        ['devices.types.light',['on_off:on','range:brightness']],
        ['devices.types.socket',['on_off:on']],
        ['devices.types.sensor.open',['event:open']],
        ['devices.types.sensor',['float:temperature','float:humidity']],
        ['devices.types.openable.curtain',['range:open']],
        ['devices.types.openable',['on_off:on','toggle:pause']],
        ['devices.types.vacuum_cleaner',['on_off:on','toggle:pause','mode:work_speed']],
        ['devices.types.camera',['video_stream:get_stream']],
        ['devices.types.thermostat',['on_off:on','range:temperature','float:temperature']]
    ];
    const copy = x => JSON.parse(JSON.stringify(x));
    const oauthSetup = window.BridgeOAuthSetup;
    const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const attr = esc;
    const bridgeMode = document.documentElement?.dataset?.bridgeMode || document.body?.dataset?.bridgeMode || 'tab';
    const ui = { tuyaCurtainState:'', oauthDiagnostic:null, oauthDiagnosticBusy:false, view:bridgeMode==='settings'?'server':'devices', selected:null, search:'', editing:null, expert:false, templates:false, smartAdd:false, candidates:[], treeObjects:[], nativePicker:null, nativePickerLoading:false, candidateStatus:'idle', candidateError:'', categories:{rooms:[],functions:[]},categoryStatus:'idle',categoryError:'', feedbackExtra:new WeakSet(), changed:null, data:null };
    function notify(text, kind='') {
        const el = document.querySelector('#notice'); if (!el) return;
        el.hidden = !text; el.className = `notice ${kind}`; el.textContent = text;
    }
    function touch() { if (ui.changed) ui.changed(); }
    function instanceId() { return 'yandex-ud-bridge.' + (Number.isFinite(Number(window.instance)) ? Number(window.instance) : 0); }
    // Materialize Admin provides a global sendTo(instance,command,data,cb) helper.
    // socket.sendTo is NOT a Materialize Admin API (and fails in Admin 7).
    function send(command, params, cb, onError) {
        let completed = false;
        const fail = message => {
            if (completed) return;
            completed = true;
            if (onError) onError(String(message));
            else notify(String(message), 'error');
        };
        const waitMs = command === 'oauthDiagnostic' ? 45000 : 20000;
        const timer = setTimeout(() => fail(`Превышено время ожидания ответа на ${command} (${Math.round(waitMs/1000)} секунд). Проверь, что экземпляр адаптера запущен.`), waitMs);
        const done = answer => {
            if (completed) return;
            clearTimeout(timer);
            if (answer?.error) return fail(answer.error);
            completed = true;
            cb?.(answer);
        };
        const error = message => { clearTimeout(timer); fail(message); };
        try {
            if (bridgeMode==='tab' && typeof window.bridgeTabSend === 'function') {
                window.bridgeTabSend(command,params,done,error);
            } else if (typeof window.sendTo === 'function') {
                // null uses the current instance, provided by Admin (works in iframe).
                window.sendTo(null, command, params, done);
            } else if (typeof window.socket?.emit === 'function') {
                // Compatibility with older Admin pages without the sendTo helper.
                window.socket.emit('sendTo', instanceId(), command, params, done);
            } else {
                error('Не найдена функция связи Admin sendTo(). Проверь загрузку adapter-settings.js в браузере (F12 → Console).');
            }
        } catch (err) { error(`Ошибка отправки ${command}: ${err.message}`); }
    }
    function loadCandidates() {
        ui.candidateStatus = 'loading'; ui.candidateError = '';
        send('candidates', {}, result => {
            if (!Array.isArray(result)) {
                ui.candidateStatus = 'error';
                ui.candidateError = 'Неправильный формат ответа сервера.';
            } else {
                ui.candidates = result.filter(c => c.objectType === 'state' || !c.objectType);
                ui.candidateStatus = ui.candidates.length ? 'ready' : 'empty';
            }
        }, message => {
            ui.candidateStatus = 'error'; ui.candidateError = message;
            notify(`Не удалось получить объекты ioBroker: ${message}`, 'error');
        });
    }
    const roomText = {
        label: 'Комната',
        empty: 'Без комнаты',
        refresh: 'Обновить',
        loading: 'Загрузка...',
        functions: 'Функции ioBroker',
        failed: 'Не удалось получить комнаты ioBroker: '
    };
    // The category ID is the canonical selection. "room" remains a cached,
    // Yandex-readable label for the provider API and imported configurations.
    // Match historic room names to ioBroker categories without silently
    // discarding an unmatched legacy room when upgrading from an old version.
    function resolvedRoom(device, rooms = ui.categories.rooms) {
        const byId = rooms.find(r => r.id === device.roomEnumId);
        if (byId) return byId;
        if (!device.room || typeof device.room !== 'string') return null;
        const normalized = device.room.trim().toLocaleLowerCase('ru');
        const matches = rooms.filter(r => typeof r.name === 'string' &&
            r.name.trim().toLocaleLowerCase('ru') === normalized);
        return matches.length === 1 ? matches[0] : null;
    }
    function matchingCategories(stateId, group) {
        if (!stateId || !ui.categories[group]) return [];
        return ui.categories[group].filter(category => Array.isArray(category.members) &&
            category.members.some(member => typeof member === 'string' &&
                (stateId === member || stateId.startsWith(member + '.'))));
    }
    function roomMatch(stateId) {
        const matches = matchingCategories(stateId, 'rooms');
        return matches.length === 1 ? matches[0] : null;
    }
    function autoRoom(device, stateId) {
        if (device.room || device.roomEnumId || device.roomManual) return false;
        const room = roomMatch(stateId);
        if (!room) return false;
        device.room = room.name;
        device.roomEnumId = room.id;
        return true;
    }
    function inferredType(stateId) {
        const matches = matchingCategories(stateId, 'functions');
        // Only make an automatic suggestion if all matched functions agree.
        const possible = new Set(matches.map(item => {
            const text = (item.id + ' ' + item.name).toLowerCase();
            if (/light|licht|lamp|osves/.test(text) || text.includes('\u0441\u0432\u0435\u0442')) return 'devices.types.light';
            if (/socket|outlet|steckdose|rozet/.test(text) || text.includes('\u0440\u043e\u0437\u0435\u0442')) return 'devices.types.socket';
            if (/gate|garage.door|vorota/.test(text) || text.includes('ворот')) return 'devices.types.openable';
            if (/curtain|shutter|blind|rollladen|shtor/.test(text) || text.includes('\u0448\u0442\u043e\u0440')) return 'devices.types.openable.curtain';
            if (/door|window|contact|okn|dver/.test(text) || text.includes('\u0434\u0432\u0435\u0440') || text.includes('\u043e\u043a\u043d')) return 'devices.types.sensor.open';
            if (/motion|bewegung/.test(text) || text.includes('\u0434\u0432\u0438\u0436\u0435\u043d')) return 'devices.types.sensor.motion';
            if (/vacuum|staubsauger|pylesos/.test(text) || text.includes('\u043f\u044b\u043b\u0435\u0441\u043e\u0441')) return 'devices.types.vacuum_cleaner';
            if (/heat|thermostat|heiz|otoplen/.test(text) || text.includes('\u043e\u0442\u043e\u043f\u043b\u0435\u043d')) return 'devices.types.thermostat';
            return '';
        }).filter(Boolean));
        return possible.size === 1 ? [...possible][0] : '';
    }
    function refreshRoomField() {
        const host = document.querySelector('#room-field');
        if (host && ui.selected !== null && ui.view === 'devices') {
            const dev=ui.data.devices[ui.selected];
            if(dev)host.innerHTML=roomField(dev,ui.selected);
        }
    }
    function loadCategories() {
        ui.categoryStatus = 'loading';ui.categoryError='';refreshRoomField();
        send('categories', {}, response => {
            if (!response || !Array.isArray(response.rooms) || !Array.isArray(response.functions)) {
                ui.categoryStatus = 'error';ui.categoryError='Invalid category response';
            } else {
                ui.categories={rooms:response.rooms,functions:response.functions};
                ui.categoryStatus='ready';
            }
            refreshRoomField();
        }, message => {
            ui.categoryStatus='error';ui.categoryError=message;
            refreshRoomField();
        });
    }
    function roomField(d,i) {
        const rooms = ui.categories.rooms;
        const selectedRoom = resolvedRoom(d, rooms);
        // Keep historic labels selectable but not editable if no matching
        // category exists. They will survive until the user picks a category.
        const legacy = !selectedRoom && (d.room || d.roomEnumId);
        const selected = selectedRoom ? selectedRoom.id : (legacy ? '__legacy__' : '');
        const choices = [['',roomText.empty], ...rooms.map(r => [r.id,r.name])];
        if (legacy) choices.push(['__legacy__', `${d.room || d.roomEnumId} (сохранено ранее)`]);
        const field = `<label class="field"><span>${roomText.label}</span><select data-action="room-choice" data-device-index="${i}">${choices.map(([id,name])=>`<option value="${attr(id)}" ${selected===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
        const status = ui.categoryStatus === 'loading' ? roomText.loading :
            ui.categoryStatus === 'error' ? `${roomText.failed}${esc(ui.categoryError)}` :
            `${rooms.length} комнат из ioBroker`;
        return `${field}<div class="field"><span>&nbsp;</span><button type="button" class="btn secondary small" data-action="reload-categories">${roomText.refresh}</button><small class="tiny-help">${status}</small></div>`;
    }
    function categoryHint(stateId) {
        if (!stateId) return '';
        const rooms=matchingCategories(stateId,'rooms').map(c=>c.name);
        const funcs=matchingCategories(stateId,'functions').map(c=>c.name);
        return funcs.length||rooms.length?`<div class="tiny-help">ioBroker: ${rooms.length?esc(rooms.join(', ')):''}${rooms.length&&funcs.length?' / ':''}${funcs.length?roomText.functions+': '+esc(funcs.join(', ')):''}</div>`:'';
    }
    function binding(did, kind, type, instance) {
        let parm = defaults[instance] || {};
        if (type === 'event' && instance === 'open') parm={instance:'open',events:[{value:'opened'},{value:'closed'}]};
        if (type === 'float' && instance === 'temperature') parm={instance:'temperature',unit:'unit.temperature.celsius'};
        return { enabled:false, deviceId:did, kind, type, instance, backend:'iobroker', stateId:'', commandId:'',retrievable:type!=='video_stream',reportable:false,
            parameters: type === 'on_off' ? '' : JSON.stringify(parm),mapping:'',readTransform:'',writeTransform:'',streamUrl:'',migrationHint:'' };
    }
    function deviceType(t) { return typeNames[t] || [t.replace('devices.types.',''), '⌂']; }
    function stateLabel(id) {
        const c = ui.candidates.find(c=>c.id===id);
        return c ? `${c.name} · ${c.role}` : id;
    }
    // Read-only display with a single explicit action to open the object-tree modal.
    function picker(field, val, id, extra = '', help = '') {
        return `<div class="field ${extra}"><span>${esc(field)}</span><div class="state-picker">
            <div class="picked-state" title="${attr(val)}">${val ? `<b>${esc(val)}</b><small>${esc(stateLabel(val))}</small>` : '<em>Не выбрано</em>'}</div>
            <button type="button" class="btn secondary small" data-action="pick-state" data-path="${attr(id)}">Выбрать…</button>
            ${val?`<button type="button" class="btn secondary small clear-state" data-action="clear-state" data-path="${attr(id)}" title="Очистить">×</button>`:''}
        </div>${help?`<div class="tiny-help">${esc(help)}</div>`:''}${categoryHint(val)}</div>`;
    }
    // The editor uses ioBroker Admin's own Materialize selectID component.
    // It is shipped by Admin (selectID.js / FancyTree), not rendered by our adapter.
    function openNativePicker(path) {
        if(ui.nativePickerLoading) return;
        const jq = window.jQuery || window.$;
        if(typeof jq !== 'function' || typeof jq.fn?.selectId !== 'function') {
            notify('Не загрузился штатный выбор объектов ioBroker (selectID.js). Проверь вкладку Network в инструментах разработчика Admin.', 'error');
            return;
        }
        const current=path.startsWith('primary.')?mainObject(ui.data.bindings[Number(path.split('.')[1])]||{}):path==='smartState'?ui.smartState||'':path==='tuyaCurtainState'?ui.tuyaCurtainState||'':locate(path)?.obj?.[locate(path).key]||'';
        const show=()=>{
            try {
                ui.nativePicker.selectId('show',current,newId=>{
                    if(typeof newId === 'string' && newId.trim()) setPickedState(path,newId.trim());
                });
            } catch(err) { notify('Не удалось открыть штатный выбор: '+err.message,'error'); }
        };
        if(ui.nativePicker) { show(); return; }
        if(typeof window.socket?.emit !== 'function') {
            notify('Нет соединения с ioBroker Admin: socket.getObjects недоступен.','error');
            return;
        }
        ui.nativePickerLoading=true;
        // The native selectID plugin requires full ioBroker objects, not the
        // compact state summaries returned by the adapter's candidates API.
        window.socket.emit('getObjects',(err,objects)=>{
            ui.nativePickerLoading=false;
            if(err || !objects || typeof objects !== 'object') {
                notify('Не удалось получить объекты для штатного диалога: '+(err?.message||err||'пустой ответ'),'error');
                return;
            }
            try {
                const container=jq('#dialog-select-member');
                ui.nativePicker=container.selectId('init',{
                    noMultiselect:true,
                    objects,
                    imgPath:'../../lib/css/fancytree/',
                    filter:{type:'state'},
                    name:'yandex-ud-bridge-select-state',
                    columns:['image','name','role','room'],
                    texts:{
                        select:'Выбрать',cancel:'Отмена',all:'Все',id:'ID',
                        name:'Название',role:'Роль',room:'Комната',value:'Значение',
                        selectid:'Выберите ID объекта',from:'От',lc:'Последнее изменение',
                        ts:'Время',wait:'Загрузка…',ack:'Подтверждено',
                        selectAll:'Выбрать всё',unselectAll:'Снять выделение',
                        invertSelection:'Инвертировать выбор'
                    }
                }) || container;
                show();
            } catch(e) { ui.nativePicker=null;notify('Ошибка штатного выбора ioBroker: '+e.message,'error'); }
        });
    }
    function setPickedState(path,value) {
        const primary=path.match(/^primary\.(\d+)$/);
        const found=primary?null:locate(path);
        if(!found && !primary && path!=='smartState' && path!=='tuyaCurtainState')return;
        if(primary) {
            const index=Number(primary[1]);const b=ui.data.bindings[index];if(!b)return;
            setMainObject(index,value);
            if(value) {
                b.enabled=true;
                const device=ui.data.devices.find(d=>d.id===b.deviceId);
                if(device)autoRoom(device,value);
            }
        } else if(path==='smartState')ui.smartState=value;
        else if(path==='tuyaCurtainState')ui.tuyaCurtainState=value;
        else {
            found.obj[found.key]=value;
            if(path.endsWith('.stateId') && value){
                const index=Number(path.match(/^bindings\.(\d+)\./)?.[1]);
                if(Number.isInteger(index)&&ui.data.bindings[index]) {ui.data.bindings[index].enabled=true;if(!value)ui.data.bindings[index].retrievable=false;}
            }
        }
        const destination=primary?value:(path.endsWith('.commandId')?value:'');
        const writeOnly=destination && ui.candidates.find(x=>x.id===destination)?.write===false;
        touch();render();
        if(writeOnly)notify('Внимание: выбранный объект ioBroker имеет common.write=false. Команды могут не работать.');
    }
    function textField(label,key,value,opts={}) { return `<label class="field ${opts.class||''}"><span>${esc(label)}</span><input type="${opts.password?'password':opts.number?'number':'text'}" data-bind="${attr(key)}" value="${attr(value)}" placeholder="${attr(opts.placeholder||'')}" ${opts.number?'min="1"':''}><small class="tiny-help">${esc(opts.help||'')}</small></label>`; }
    function selectField(label,key,value,opts) { return `<label class="field"><span>${esc(label)}</span><select data-bind="${attr(key)}">${opts.map(([v,n])=>`<option value="${attr(v)}" ${v===value?'selected':''}>${esc(n)}</option>`).join('')}</select></label>`; }
    function checkField(label,key,value) { return `<label class="field"><span>&nbsp;</span><div style="padding-top:11px"><input type="checkbox" data-bind="${attr(key)}" ${value?'checked':''}><b>${esc(label)}</b></div></label>`; }
    function showDevices() {
        const d = ui.data.devices || [];
        const terms=ui.search.trim().toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
        const matches=d.map((item,i)=>({item,i})).filter(({item})=>{
            const type=deviceType(item.type)[0];
            const room=resolvedRoom(item)?.name || item.room || '';
            const text=[item.id,item.name,item.room,item.roomEnumId,room,item.type,type,item.description]
                .filter(Boolean).join(' ').toLocaleLowerCase('ru');
            return terms.every(term=>text.includes(term));
        });
        document.querySelector('#top-action').innerHTML = `<div class="button-row"><button class="btn secondary" data-action="smart-add">✦ Из состояния ioBroker</button><button class="btn" data-action="new">＋ Добавить устройство</button></div>`;
        let html = `<div class="toolbar"><input class="search" id="device-search" type="search" placeholder="Поиск по названию, типу, комнате или ID…" value="${attr(ui.search)}"><span class="count">${matches.length} из ${d.length} устройств</span></div>`;
        if (ui.templates) html += templateOptions();
        if (ui.smartAdd) html += `<div class="panel"><h2>Создать устройство из состояния ioBroker</h2><p class="muted">Выберите ID объекта: адаптер предложит тип устройства и функцию на основании common.role.</p><div class="fields">${picker('Состояние ioBroker', ui.smartState||'', 'smartState')}<div class="button-row" style="align-self:center"><button class="btn" data-action="create-state">Создать устройство</button><button class="btn secondary" data-action="hide-state">Отмена</button></div></div></div>`;
        if (!matches.length) html += `<div class="empty"><div style="font-size:38px">⌂</div><strong>${d.length?'Ничего не найдено':'Добавьте первое устройство'}</strong><p>Выберите шаблон, а затем привяжите состояния ioBroker.</p><button class="btn" data-action="new">＋ Добавить</button></div>`;
        else html += `<div class="cards">${matches.map(({item,i})=>{
            const [label,glyph] = deviceType(item.type);
            const rows = ui.data.bindings.filter(b=>b.deviceId===item.id);
            const ready = rows.filter(b=>b.enabled && (b.stateId || b.commandId || (b.type==='video_stream' && b.streamUrl))).length;
            const onlineRows = hasAvailability(item) ? 1 : 0;
            const onlineReady = onlineRows && item.onlineEnabled!==false && (item.onlineAlways || item.onlineStateId) ? 1 : 0;
            return `<article class="device-card" role="button" tabindex="0" data-action="open" data-index="${i}"><div class="card-top"><div class="glyph">${glyph}</div><div><div class="card-name">${esc(item.name||item.id)}</div><div class="card-room">${esc(item.room||label)}</div></div></div><div class="card-footer"><span>${rows.length + onlineRows} функций · ${ready + onlineReady} подключено</span><span class="tag ${!item.enabled?'off':!ready?'warn':''}">${!item.enabled?'Отключено':ready?'Готово':'Настроить'}</span></div></article>`;
        }).join('')}</div>`;
        document.querySelector('#content').innerHTML = html;
    }
    function templateOptions() { return `<div class="panel"><div class="detail-head"><h2>Выберите шаблон</h2><button class="btn secondary small" data-action="hide-templates">Закрыть ×</button></div><div class="template-options">${templates.map(([name],i)=>`<button class="template" data-action="use-template" data-index="${i}"><span>${deviceType(name)[1]}</span><b>${esc(deviceType(name)[0])}</b><small class="muted">Добавить с готовыми функциями</small></button>`).join('')}<button class="template" data-action="use-template" data-index="-1"><span>＋</span><b>Пустое устройство</b><small class="muted">Настроить вручную</small></button></div></div>`; }
    function findIndex(i) { return ui.data.bindings.map((b,j)=>({b,j})).filter(x=>x.b.deviceId===ui.data.devices[i].id); }
    function functionName(b) { return available.find(a=>a[0]===b.kind && a[1]===b.type && a[2]===b.instance)?.[3] || `${b.type} / ${b.instance}`; }
    // Availability looks like an ordinary property in the editor, but is kept in
    // devices[].onlineStateId / onlineInvert to preserve its original meaning.
    // A missing onlineEnabled flag means legacy enabled-by-state behavior.
    function hasAvailability(d) { return d.onlineEnabled === true || d.onlineAlways === true || !!d.onlineStateId; }
    function renderAvailability(d, i) {
        const active = ui.editing === 'availability';
        const enabled = d.onlineEnabled !== false;
        const status = !enabled ? 'Не активно' : d.onlineAlways ? 'Всегда в сети' : d.onlineStateId ? 'Подключено' : 'Не привязано';
        return `<div class="function-box availability-property"><div class="function-summary">
            <div class="summary-left"><div class="summary-icon">◉</div><div><div class="function-title">Доступность</div><div class="muted">Свойство · ${status}</div></div></div>
            <div class="function-tools"><button class="btn secondary small" data-action="toggle-availability">${active?'Свернуть':'Настроить'} ${active?'↑':'↓'}</button>
                <button class="btn text-button small" data-action="remove-availability" title="Удалить">✕</button></div></div>
            ${active ? `<div class="function-body availability-body">
                <div class="fields">${checkField('Использовать свойство',`devices.${i}.onlineEnabled`,enabled)}
                    <div class="span-all">${checkField('Всегда доступен (игнорировать offline устройства)',`devices.${i}.onlineAlways`,!!d.onlineAlways)}</div>
                    ${!d.onlineAlways ? `${picker('Объект ioBroker (available / online)',d.onlineStateId||'',`devices.${i}.onlineStateId`,'span-all',
                        'Например zigbee.0.xxx.available или mqtt.0.xxx.online. Значение true или 1 означает «В сети».')}
                    <div class="span-all">${checkField('Инвертировать значение (0 = в сети)',`devices.${i}.onlineInvert`,!!d.onlineInvert)}</div>` : '<div class="span-all tiny-help">Проверка доступности отключена. Яндекс получает online, даже когда объект available показывает offline. Реальное выполнение команд этим не гарантируется.</div>'}</div>
                <p class="tiny-help">Служебное свойство: при недоступности команды Яндекса получают DEVICE_UNREACHABLE.
                    Статус «Не в сети» обновляется в приложении Яндекса через callback, если он настроен.</p>
            </div>` : ''}</div>`;
    }
    function renderFunction(b, j) {
        const active = ui.editing===j;
        const status = b.enabled ? (b.stateId||b.commandId||b.streamUrl ? 'Подключено' : 'Не привязано') : 'Не активно';
        return `<div class="function-box"><div class="function-summary"><div class="summary-left"><div class="summary-icon">${b.kind==='property'?'◉':'↔'}</div><div><div class="function-title">${esc(functionName(b))}</div><div class="muted">${b.kind==='property'?'Свойство':'Управление'} · ${status}</div></div></div><div class="function-tools"><button class="btn secondary small" data-action="toggle-function" data-index="${j}">${active?'Свернуть':'Настроить'} ${active?'↑':'↓'}</button><button class="btn text-button small" data-action="del-function" data-index="${j}" title="Удалить">✕</button></div></div>${active?functionBody(b,j):''}</div>`;
    }
    // Storage compatibility: stateId remains the read source, commandId the optional
    // write destination. The editor intentionally presents ONE primary object.
    // Existing configurations are never rewritten when simply opened or saved.
    function mainObject(b) {
        return b.kind==='property' ? (b.stateId||'') : (b.commandId || b.stateId || '');
    }
    function hasSeparateFeedback(b) {
        return b.kind==='capability' && (ui.feedbackExtra.has(b) || !!(b.commandId && b.stateId && b.commandId!==b.stateId));
    }
    function setMainObject(j,value) {
        const b=ui.data.bindings[j];if(!b)return;
        const separate=hasSeparateFeedback(b);
        if(b.kind==='property') {b.stateId=value;return;}
        if (!value) { b.commandId='';b.stateId='';ui.feedbackExtra.delete(b);return; }
        if(separate) {
            b.commandId=value;
            // Feedback is independent once separate reading is enabled.
        } else if (b.retrievable===false || b.commandMode==='stop_only') {
            b.commandId=value;b.stateId='';
        } else {
            // The same state is used for commands and feedback; no second picker.
            if(b.commandId) {b.commandId=value;b.stateId=value;}
            else b.stateId=value;
        }
    }
    function functionBody(b,j) {
        const prefix=`bindings.${j}.`;
        const property=b.kind==='property', stream=b.type==='video_stream';
        const primary=mainObject(b);
        const separate=hasSeparateFeedback(b);
        const canQuery=!stream && b.commandMode!=='stop_only';
        let h = `<div class="function-body"><div class="fields">
            ${checkField('Использовать функцию',prefix+'enabled',b.enabled)}
            ${canQuery?checkField('Яндекс может запрашивать значение',prefix+'retrievable',b.retrievable!==false):''}
            ${stream?textField('URL потока HLS',prefix+'streamUrl',b.streamUrl,{class:'span-all',placeholder:'https://…/playlist.m3u8'})
            :picker(property?'Источник данных ioBroker':'Основной объект ioBroker',primary,`primary.${j}`,'span-all',
                property?'Значение читается из этого объекта.':
                'Команды отправляются в этот объект. По умолчанию из него же читается состояние, если включён запрос значения.')}
            </div>`;
        if(!property && !stream) {
            h += `<div class="unified-feedback"><label class="expert-toggle">
                <input type="checkbox" data-action="separate-feedback" data-index="${j}" ${separate?'checked':''}>
                Читать состояние из отдельного объекта</label>
                ${separate?`<div class="fields">${picker('Объект обратной связи',b.stateId||'',prefix+'stateId','span-all',
                    'Только для чтения фактического состояния (например, ACTUAL отдельно от SET). Не используется для команд.')}</div>`:''}
                ${b.commandMode==='enum_open_close'?'<p class="tiny-help">Для команд OPEN/CLOSE объект может быть только записываемым. Если реальное положение неизвестно, отключите запрос значения.</p>':''}
            </div>`;
        }
        if (b.migrationHint) h += `<div class="hint"><b>Из старого config.js:</b> ${esc(b.migrationHint)}<br>Нужно выбрать состояния ioBroker. MQTT-топики не выполняются.</div>`;
        if(!stream) {
            h += `<div class="divider-line"></div><div class="unified-transforms"><b>Значения и команды</b>
                <p class="tiny-help">Настрой запись Яндекс → ioBroker таблицей значений (например, Включено → 100, Выключено → 0). Кнопка ⇄ создаёт обратную таблицу, а для датчиков или положения во время движения чтение можно настроить отдельно по порогу.</p>
                <div class="fields">${b.commandMode==='stop_only'?'<p class="tiny-help">Функция STOP не сообщает текущее состояние.</p>':transformEditor(b,j,'readTransform')}${property?'':transformEditor(b,j,'writeTransform')}</div></div>`;
        }
        h += `<div class="button-row"><label class="expert-toggle"><input type="checkbox" data-bind="${prefix}reportable" ${b.reportable?'checked':''}> Передавать события об изменениях (callback)</label></div>`;
        if(ui.expert) h += `<div class="divider-line"></div><div class="fields">${textArea('Параметры API Яндекса (JSON)',prefix+'parameters',b.parameters)}${textArea('Соответствия значений (JSON)',prefix+'mapping',b.mapping)}</div><div class="fields three">${textField('Тип API',prefix+'type',b.type)}${textField('instance',prefix+'instance',b.instance)}${selectField('Назначение',prefix+'kind',b.kind,[['capability','Управление'],['property','Свойство']])}</div>`;
        return h + '</div>';
    }
    // Human-friendly transform forms. Serialized native readTransform/writeTransform
    // remain fully backward-compatible with earlier versions of the adapter.
    const transformKinds = [
        ['', 'Без преобразования'], ['boolean','Логическое значение (true/false)'],
        ['lookup','Таблица соответствий'], ['threshold','Сравнение с порогом'],
        ['invert','Инверсия (максимум − значение)'], ['scale','Пересчёт диапазона']
    ];
    const transformDefaults = {
        boolean: {type:'boolean'},
        lookup: {type:'lookup',pairs:[['',''],['','']]},
        threshold: {type:'threshold',operator:'gt',value:0},
        invert: {type:'invert',max:100},
        scale: {type:'scale',from:[0,100],to:[0,1000]}
    };
    const numericLiteral = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i;
    function autoValue(text, yandexBoolean) {
        const value=String(text??'').trim();
        if(yandexBoolean && /^(true|false)$/i.test(value))return value.toLowerCase()==='true';
        // A number typed into a form is a number in ioBroker, not a quoted string.
        if(numericLiteral.test(value) && Number.isFinite(Number(value)))return Number(value);
        return value;
    }
    function asInputText(value) {return value==null?'':String(value);}
    function getTransform(b,which) {
        try {return JSON.parse(b[which]||'{}');} catch {return {};}
    }
    function putTransform(b,which,transform) {
        b[which]=JSON.stringify(transform);
        if(which==='writeTransform')b.commandMode='direct';
        touch();
    }
    function isYandexBoolean(b) {return b.type==='on_off'||b.type==='toggle';}
    function isBooleanCell(b,which,side) {
        const yandex=which==='writeTransform'?side===0:side===1;
        if(yandex)return isYandexBoolean(b);
        const local=which==='readTransform' ? (b.stateId||mainObject(b)) : mainObject(b);
        return ui.candidates.find(c=>c.id===local)?.type==='boolean';
    }
    function mapCell(b,j,which,index,side,value) {
        const yandex = which==='writeTransform' ? side===0 : side===1;
        const name=which==='writeTransform' ? (side===0?'Яндекс':'ioBroker') : (side===0?'ioBroker':'Яндекс');
        const field=`data-map-row="${j}" data-map-direction="${which}" data-map-index="${index}" data-map-side="${side}"`;
        if(isBooleanCell(b,which,side)) {
            return `<label class="map-cell"><small>${name}</small><select ${field} aria-label="${name}, строка ${index+1}">
                <option value="" ${value===''?'selected':''}>Выберите…</option>
                <option value="true" ${value===true?'selected':''}>Включено (true)</option>
                <option value="false" ${value===false?'selected':''}>Выключено (false)</option>
                </select></label>`;
        }
        return `<label class="map-cell"><small>${name}</small><input type="text" ${field}
            value="${attr(asInputText(value))}" placeholder="${yandex?'Значение Яндекса':'Значение ioBroker'}"
            aria-label="${name}, строка ${index+1}" spellcheck="false"></label>`;
    }
    function simpleTransformFields(b,j,which,t) {
        if(t.type==='lookup') {
            const pairs=Array.isArray(t.pairs)?t.pairs:[];
            const rows=pairs.map((pair,i)=>`<div class="map-pair">
                ${mapCell(b,j,which,i,0,pair[0])}<span class="map-arrow" aria-hidden="true">→</span>
                ${mapCell(b,j,which,i,1,pair[1])}
                <button type="button" class="btn secondary small" data-transform-remove="${j}" data-transform-direction="${which}" data-transform-index="${i}" aria-label="Удалить строку ${i+1}" title="Удалить строку">✕</button>
                </div>`).join('');
            return `<div class="map-pairs">${rows}
                <div class="button-row"><button type="button" class="btn secondary small" data-transform-add="${j}" data-transform-direction="${which}">＋ Добавить значение</button>
                <button type="button" class="btn secondary small" data-transform-mirror="${j}" data-transform-direction="${which}" title="Создать таблицу для противоположного направления">⇄ Скопировать в обратную сторону</button></div>
                <p class="tiny-help">Числа (например 0, 100, -1, 0.5) сохраняются числами, слова — строками. Для функций включения и выключения Яндекс использует true/false.</p>
                </div>`;
        }
        if(t.type==='threshold')return `<div class="transform-controls">
            <label class="field"><span>Условие</span><select data-transform-param-row="${j}" data-transform-param-direction="${which}" data-transform-param="operator">
            ${[['gt','Больше (>)'],['gte','Больше или равно (≥)'],['lt','Меньше (<)'],['lte','Меньше или равно (≤)'],['eq','Равно (=)'],['neq','Не равно (≠)']].map(([key,label])=>`<option value="${key}" ${key===t.operator?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
            <label class="field"><span>Значение порога</span><input type="number" step="any" data-transform-param-row="${j}" data-transform-param-direction="${which}" data-transform-param="value" value="${attr(t.value)}"></label></div>`;
        if(t.type==='invert')return `<div class="transform-controls"><label class="field"><span>Максимум</span><input type="number" step="any" data-transform-param-row="${j}" data-transform-param-direction="${which}" data-transform-param="max" value="${attr(t.max)}"></label></div>`;
        if(t.type==='scale')return `<div class="transform-controls scale-controls">
            ${[['from.0','Исходный минимум',t.from?.[0]],['from.1','Исходный максимум',t.from?.[1]],['to.0','Новый минимум',t.to?.[0]],['to.1','Новый максимум',t.to?.[1]]].map(([key,label,value])=>`<label class="field"><span>${label}</span><input type="number" step="any" data-transform-param-row="${j}" data-transform-param-direction="${which}" data-transform-param="${key}" value="${attr(value)}"></label>`).join('')}</div>`;
        return '';
    }
    function transformEditor(b,j,which) {
        const parsed=getTransform(b,which);
        const special=which==='writeTransform' &&
            (b.commandMode==='enum_open_close' && b.type==='on_off' ? 'enum_open_close' :
                b.commandMode==='stop_only' && b.type==='toggle' && b.instance==='pause' ? 'stop_only' : '');
        const type=special || parsed.type || '';
        const dir=which==='readTransform'?'Чтение: ioBroker → Яндекс':'Запись: Яндекс → ioBroker';
        const extra=which==='writeTransform'
            ? (b.type==='on_off'?[['enum_open_close','Команды OPEN / CLOSE (строки)']]:
                b.type==='toggle' && b.instance==='pause'?[['stop_only','Команда STOP при включении']]:[])
            : [];
        const options=[...transformKinds,...extra];
        let fields='';
        if(type==='enum_open_close') fields=`<div class="fields">${textField('Открыть',`bindings.${j}.openValue`,b.openValue??'OPEN')}${textField('Закрыть',`bindings.${j}.closeValue`,b.closeValue??'CLOSE')}</div>
            <p class="tiny-help">Число в поле команды (0, 100) отправится числом; слово (OPEN, CLOSE) — строкой. Для разных значений чтения и записи используй таблицы соответствий.</p>`;
        else if(type==='stop_only') fields=`<div class="fields">${textField('Остановить',`bindings.${j}.stopValue`,b.stopValue??'STOP')}</div>
            <p class="tiny-help">Команда STOP отправляется только при значении true. Чтение статуса паузы недоступно.</p>`;
        else if(type) fields=simpleTransformFields(b,j,which,parsed);
        return `<div class="transform-block"><label class="field"><span>${esc(dir)}</span>
            <select data-transform-row="${j}" data-transform-direction="${which}">
            ${options.map(([v,label])=>`<option value="${attr(v)}" ${v===type?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
            ${fields}
            <p class="tiny-help">${which==='readTransform'
                ?'Преобразование фактического состояния перед отправкой Яндексу.'
                :'Преобразование команды перед записью в ioBroker.'}</p></div>`;
    }
    function updateTransformInput(target) {
        const dataset=target.dataset;
        const j=Number(dataset.mapRow??dataset.transformParamRow);
        const b=ui.data.bindings[j];if(!b)return false;
        const which=dataset.mapDirection??dataset.transformParamDirection;
        if(!['readTransform','writeTransform'].includes(which))return false;
        const t=getTransform(b,which);
        if(dataset.mapRow!==undefined) {
            if(t.type!=='lookup')return false;
            const i=Number(dataset.mapIndex),side=Number(dataset.mapSide);
            if(!Array.isArray(t.pairs) || !Array.isArray(t.pairs[i]) || ![0,1].includes(side))return false;
            t.pairs[i][side]=autoValue(target.value,isBooleanCell(b,which,side));
        } else if(dataset.transformParamRow!==undefined) {
            const param=dataset.transformParam;
            if(param==='operator')t.operator=target.value;
            else {
                const n=Number(target.value);
                if(target.value.trim()==='' || !Number.isFinite(n))return false;
                if(/^(from|to)\.[01]$/.test(param)) {
                    const [arr,k]=param.split('.');if(!Array.isArray(t[arr]))return false;
                    t[arr][Number(k)]=n;
                } else if(['value','max'].includes(param))t[param]=n;
                else return false;
            }
        } else return false;
        putTransform(b,which,t);
        return true;
    }
    function changeTransformRows(target) {
        const kind=target.dataset.transformAdd!==undefined?'add':target.dataset.transformRemove!==undefined?'remove':'mirror';
        const j=Number(target.dataset.transformAdd??target.dataset.transformRemove??target.dataset.transformMirror);
        const which=target.dataset.transformDirection;
        const b=ui.data.bindings[j];if(!b || !['readTransform','writeTransform'].includes(which))return;
        const t=getTransform(b,which);if(t.type!=='lookup'||!Array.isArray(t.pairs))return;
        if(kind==='add') {
            if(t.pairs.length>=256)return notify('Максимум 256 соответствий','error');
            t.pairs.push(['','']);putTransform(b,which,t);render();return;
        }
        if(kind==='remove') {
            t.pairs.splice(Number(target.dataset.transformIndex),1);
            if(!t.pairs.length)t.pairs.push(['','']);
            putTransform(b,which,t);render();return;
        }
        if(t.pairs.some(pair=>pair.length!==2 || pair.some(v=>v==='')))return notify('Перед копированием заполни все значения таблицы','error');
        const other=which==='readTransform'?'writeTransform':'readTransform';
        const reversed={type:'lookup',pairs:t.pairs.map(pair=>[pair[1],pair[0]])};
        if(new Set(reversed.pairs.map(pair=>JSON.stringify(pair[0]))).size!==reversed.pairs.length)
            return notify('Нельзя создать обратную таблицу: одинаковые значения ioBroker имеют разные соответствия. Настрой чтение отдельно.','error');
        // Warn rather than silently overwriting a different existing transform.
        if(b[other] && b[other]!==JSON.stringify(reversed) && !window.confirm('Заменить преобразование в другом направлении обратной таблицей?'))return;
        putTransform(b,other,reversed);render();
        notify('Обратная таблица создана. Проверь значения и сохрани настройки.','ok');
    }
    function suggestedCurtainControl(device) {
        const existing=ui.data.bindings.filter(b=>b.deviceId===device.id);
        const states=[ui.tuyaCurtainState,...existing.flatMap(b=>[b.commandId,b.stateId]),device.onlineStateId].filter(Boolean);
        for(const id of states) {
            const match=String(id).match(/^(tuya\.\d+\.[^.]+)\.(?:1|2|3|online)$/);
            if(match)return match[1];
        }
        return '';
    }
    function curtainPresetPanel(device) {
        if (device.type!=='devices.types.openable.curtain') return '';
        const base=suggestedCurtainControl(device);
        return `<div class="panel tuya-panel"><div class="detail-head"><div><h2>Шторы Tuya · простая настройка</h2>
            <p class="muted">Один объект percent_control. Открыть = 0%, закрыть = 100%. Яндекс использует on_off и range.open; обе функции записывают только в percent_control.</p></div></div>
            <div class="fields">${picker('Объект Tuya percent_control',ui.tuyaCurtainState|| (base?base+'.2':''),'tuyaCurtainState','span-all',
            'Выбери объект ioBroker, соответствующий percent_control. Он должен поддерживать запись.')}</div>
            <div class="hint">Яндекс: открыть → 0, закрыть → 100. Положение для Яндекса инвертируется (0% Tuya = 100% открытия).</div>
            <button class="btn" data-action="apply-tuya-curtain">Применить к этим шторам</button>
            <p class="tiny-help">Заменяет старые привязки выбранных штор на on_off и range.open с одним объектом Tuya. Отключить = 100 (закрыть), включить = 0 (открыть). После нажатия сохрани и синхронизируй устройства с Яндексом.</p></div>`;
    }
    function applyTuyaCurtainPreset() {
        const device=ui.data.devices[ui.selected];
        if(!device || device.type!=='devices.types.openable.curtain') return;
        const stateId=String(ui.tuyaCurtainState || (suggestedCurtainControl(device) ? suggestedCurtainControl(device)+'.2' : '')).trim();
        if(!/^tuya\.\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(stateId)) {
            notify('Выбери объект состояния Tuya percent_control.','error');return;
        }
        if(ui.candidateStatus!=='ready') {
            notify('Дождись загрузки списка объектов ioBroker.','error');return;
        }
        const candidate=ui.candidates.find(c=>c.id===stateId);
        if(!candidate) {notify(`Не найден объект ${stateId}.`,'error');return;}
        if(candidate.write === false) {notify(`Объект ${stateId} недоступен для записи.`,'error');return;}
        const existing=ui.data.bindings.filter(b=>b.deviceId===device.id && b.kind==='capability' &&
            (b.type==='on_off' || (b.type==='range'&&b.instance==='open')));
        if(existing.length && !window.confirm(`Заменить старые привязки штор «${device.name}» на две функции (on_off и положение), использующие только ${stateId}?`))return;
        ui.data.bindings=ui.data.bindings.filter(b=>!existing.includes(b));
        const row=binding(device.id,'capability','range','open');
        Object.assign(row,{enabled:true,backend:'iobroker',stateId,commandId:stateId,
            retrievable:true,mapping:'',readTransform:JSON.stringify({type:'invert',max:100}),writeTransform:JSON.stringify({type:'invert',max:100}),
            parameters:JSON.stringify({instance:'open',random_access:true,
                range:{min:0,max:100,precision:1},unit:'unit.percent'})});
        ui.data.bindings.push(row);
        const onOff=binding(device.id,'capability','on_off','on');
        Object.assign(onOff,{enabled:true,backend:'iobroker',stateId,commandId:stateId,
            retrievable:true,mapping:'',
            readTransform:JSON.stringify({type:'threshold',operator:'lt',value:100}),
            writeTransform:JSON.stringify({type:'lookup',pairs:[[false,100],[true,0]]}),
            parameters:''});
        ui.data.bindings.push(onOff);
        const prefix=stateId.slice(0,stateId.lastIndexOf('.'));
        const known=new Set(ui.candidates.map(c=>c.id));
        if(!device.onlineStateId && known.has(`${prefix}.online`)) {device.onlineStateId=`${prefix}.online`;device.onlineEnabled=true;}
        ui.tuyaCurtainState=stateId;
        touch();render();
        notify(`Привязки созданы: on_off false = 100, true = 0; положение инвертируется, запись в ${stateId}. Сохрани настройки и обнови устройства в Яндексе.`, 'ok');
    }
    function textArea(label,key,value) { return `<label class="field"><span>${esc(label)}</span><textarea data-bind="${attr(key)}" spellcheck="false">${esc(value)}</textarea></label>`; }
    function showDetail() {
        const i = ui.selected, d = ui.data.devices[i];
        if (!d) { ui.view='devices'; ui.selected=null; return showDevices(); }
        const rows = findIndex(i);
        document.querySelector('#top-action').innerHTML = `<div class="button-row"><button class="btn secondary small" data-action="duplicate">Дублировать</button><button class="btn danger small" data-action="delete-device">Удалить</button></div>`;
        document.querySelector('#content').innerHTML = `<button class="back-link" data-action="back">← Ко всем устройствам</button>
            <div class="panel"><div class="detail-head"><h2>Основные настройки</h2><span class="tag ${d.enabled?'':'off'}">${d.enabled?'Включено':'Выключено'}</span></div>
            <div class="fields">${textField('Название',`devices.${i}.name`,d.name)}${textField('ID устройства · желательно не изменять',`devices.${i}.id`,d.id)}
            ${selectField('Тип устройства для Алисы',`devices.${i}.type`,d.type,Object.entries(typeNames).map(([id,[name]])=>[id,name]))}
            <div id="room-field" class="span-all room-fields">${roomField(d,i)}</div>
            ${checkField('Показывать в Яндексе',`devices.${i}.enabled`,d.enabled)}
            ${textField('Описание',`devices.${i}.description`,d.description,{class:'span-all'})}</div></div>
            ${curtainPresetPanel(d)}
            <div class="panel"><div class="detail-head"><div><h2 style="margin-bottom:4px">Возможности и свойства</h2><p class="muted">Для управления выбери один основной объект. Если чтение выполняется из другого объекта, включи отдельную обратную связь.</p></div><label class="expert-toggle"><input type="checkbox" data-action="expert" ${ui.expert?'checked':''}> Экспертный режим</label></div>
            ${rows.map(({b,j})=>renderFunction(b,j)).join('')}
            ${hasAvailability(d) ? renderAvailability(d,i) : ''}
            ${!rows.length && !hasAvailability(d) ? '<div class="hint">Устройство пока не содержит функций.</div>' : ''}
            <div class="button-row" style="margin-top:16px"><select id="add-function-select" class="dropdown"><option value="">Выберите функцию…</option>${available.map((a,k)=>`<option value="${k}">${a[0]==='property'||a[0]==='system'?'Свойство':'Управление'} — ${esc(a[3])}</option>`).join('')}</select><button class="btn secondary" data-action="add-function">＋ Добавить функцию</button></div></div>`;
    }
    function oauthUrlCard(d) {
        let urls;
        try { urls = oauthSetup?.addresses(d.publicBaseUrl); }
        catch (err) { return `<p class="notice error">${esc(err.message)}</p>`; }
        if (!urls) return `<p class="muted">Для формирования адресов укажи публичный HTTPS-домен в разделе «Сервер и HTTPS».</p><p class="muted">API: /provider/v1.0/ · Авторизация: /oauth/authorize · Получение и обновление токена: /oauth/token</p>`;
        return `<ul class="status-list"><li>Endpoint API: <code>${esc(urls.provider)}</code></li><li>URL авторизации: <code>${esc(urls.authorize)}</code></li><li>URL токена: <code>${esc(urls.token)}</code></li><li>URL обновления: <code>${esc(urls.refresh)}</code></li></ul><button class="btn secondary small" data-action="oauth-copy-all">Скопировать параметры для Яндекса</button><p class="muted">Адреса формируются автоматически, но nginx и настройки навыка Яндекса меняются отдельно.</p>`;
    }
    async function oauthCopy(text) {
        if (!text) { notify('Значение ещё не задано.','error'); return; }
        try {
            if (!window.navigator?.clipboard?.writeText) throw new Error('Clipboard API недоступен. Используй HTTPS для страницы Admin.');
            await window.navigator.clipboard.writeText(text);
            notify('Скопировано в буфер обмена.', 'ok');
        } catch (err) { notify(`Не удалось скопировать: ${err.message}`, 'error'); }
    }
    function oauthDiagnosticMarkup() {
        const result = ui.oauthDiagnostic;
        if (ui.oauthDiagnosticBusy) return '<p class="muted">Проверяется локальный OAuth и API Яндекса…</p>';
        if (!result) return '<p class="muted">Тест не запускался. Проверка использует реальные HTTP-маршруты, не выполняет команды устройствам и удаляет созданные тестовые токены.</p>';
        const allOk = result.ok && !(result.steps || []).some(step => step.status === 'error');
        const heading = allOk ? 'Локальный API и OAuth работают' : 'Найдены ошибки при локальной проверке';
        const items = (result.steps || []).map(step => {
            const status = step.status === 'ok' ? '✔' : step.status === 'warning' ? '!' : '✖';
            return `<li class="diag-result ${esc(step.status)}"><span class="diag-symbol">${status}</span><div><strong>${esc(step.title)}</strong><p>${esc(step.message)}</p></div><small>${Number(step.elapsedMs)||0} мс</small></li>`;
        }).join('');
        return `<div class="diag-summary ${allOk ? 'diag-good' : 'diag-bad'}"><b>${heading}</b><span>${esc(result.testedAt || '')} · ${Number(result.durationMs)||0} мс · устройств: ${Number(result.deviceCount)||0}</span></div><ol class="diag-results">${items}</ol>`;
    }
    function showSettings() {
        document.querySelector('#top-action').innerHTML = '';
        const d=ui.data;
        let h='';
        if (ui.view==='server') h=`<div class="panel"><h2>HTTP API провайдера</h2><div class="fields">${textField('Интерфейс прослушивания','listenHost',d.listenHost||'127.0.0.1',{help:'Рекомендуется 127.0.0.1 и HTTPS reverse proxy'})}${textField('Порт','listenPort',d.listenPort||8096,{number:true})}${textField('Публичный HTTPS-адрес','publicBaseUrl',d.publicBaseUrl||'',{class:'span-all',placeholder:'https://smart.example.ru',help:'Нужен только для формирования готовых URL в настройках OAuth; не настраивает nginx автоматически.'})}</div><div class="hint">Все обращения Яндекса направляются в новый адаптер. Старый yandex2mqtt больше не нужен.</div></div><div class="panel"><h2>Адреса для настройки навыка</h2>${oauthUrlCard(d)}</div>`;
        else if (ui.view==='auth') h=`<div class="panel">
            <div class="detail-head"><div><h2>OAuth: подключение Яндекса</h2><p class="muted">Есть две разные пары реквизитов: для Яндекса и для входа на страницу разрешения доступа.</p></div>
            <button class="btn" data-action="oauth-generate" ${!oauthSetup?.allEmpty(d)?'disabled title="Уже есть настройки OAuth — генерация полного комплекта заблокирована"':''}>⚡ Первоначальная настройка</button></div>
            <div class="hint">${oauthSetup?.allEmpty(d)?'Если все поля пустые, первоначальная настройка создаст обе пары. После этого нажми «Сохранить».':'OAuth уже настроен полностью или частично. Client ID и Client Secret не заменяются автоматически: они могут использоваться в опубликованном навыке Яндекса.'}</div>
            <h2>1. Реквизиты приложения (для настроек навыка Яндекса)</h2>
            <p class="muted">Не вводи их на странице «Умный дом · Авторизация».</p>
            <div class="fields">${textField('Client ID для Яндекс Диалогов','oauthClientId',d.oauthClientId)}${textField('Client Secret для Яндекс Диалогов','oauthClientSecret',d.oauthClientSecret,{password:true})}</div>
            <div class="button-row"><button class="btn secondary small" data-action="oauth-copy" data-field="oauthClientId">Скопировать Client ID</button><button class="btn secondary small" data-action="oauth-copy" data-field="oauthClientSecret">Скопировать Secret</button></div>
            <div class="divider-line"></div>
            <div class="detail-head"><div><h2>2. Учётная запись для входа</h2><p class="muted">Именно этот логин и пароль вводятся на странице, открывающейся при привязке навыка.</p></div>
            <button class="btn secondary" data-action="oauth-reset-login">Создать новый пароль для входа</button></div>
            <div class="fields">${textField('Логин на странице авторизации','oauthLogin',d.oauthLogin)}${textField('Пароль на странице авторизации','oauthPassword',d.oauthPassword,{password:true})}${textField('ID пользователя устройств','oauthUserId',d.oauthUserId||'1',{help:'Внутренний ID одного пользователя, обычно 1.'})}</div>
            <div class="button-row"><button class="btn secondary small" data-action="oauth-copy" data-field="oauthLogin">Скопировать логин</button><button class="btn secondary small" data-action="oauth-copy" data-field="oauthPassword">Скопировать пароль</button></div>
            <div class="hint">Новый пароль создаётся случайно, но начинает действовать только после штатного сохранения настроек. Client ID и Client Secret не меняются. Скопируй новый пароль до закрытия настроек.</div>
            <div class="divider-line"></div><h2>Готовые адреса для Яндекса</h2>${oauthUrlCard(d)}
            <div class="hint"><b>Важно:</b> изменение Client ID или Secret потребует обновить опубликованный навык. Изменение пароля для входа не меняет уже выданные OAuth-токены.</div></div>`;
        else if (ui.view==='migration') h=`<div class="panel"><h2>Импорт старого config.js</h2><p>Выбери файл со своего компьютера. Импортируются только устройства, функции и названия. OAuth, логины, пароли, MQTT-подключение, сертификаты и остальные настройки игнорируются.</p><div class="button-row"><button class="btn" data-action="import-file">⇢ Выбрать config.js</button><span class="muted">Максимальный размер: 2 МБ</span></div><div class="hint">MQTT-привязки не используются: в карточке импортированного устройства будут подсказки со старыми топиками. Для работы выбери соответствующие состояния ioBroker.</div></div>`;
        else if (ui.view==='diagnostic') h=`<div class="panel"><div class="detail-head"><div><h2>Предпросмотр для Яндекса</h2><p class="muted">Проверьте описание устройств без изменения их состояния</p></div><button class="btn" data-action="preview">Обновить JSON</button></div><p class="muted">Предпросмотр включает только включённые и подключённые функции. Это конфигурация до сохранения; реальные команды не выполняются.</p><pre id="preview-result">Нажмите «Обновить JSON»</pre></div><div class="panel"><h2>Проверка подключения</h2><ul class="status-list"><li>HTTP: <code>${esc(d.listenHost||'127.0.0.1')}:${esc(d.listenPort||8096)}</code></li><li>OAuth: ${d.oauthClientId&&d.oauthClientSecret&&d.oauthLogin&&d.oauthPassword?'Настроен':'Нужно заполнить Client ID, secret и пароль'}</li><li>Устройства: ${d.devices.length}</li><li>Активные функции: ${d.bindings.filter(b=>b.enabled&&(b.stateId||b.commandId||b.streamUrl)).length}</li></ul></div>`;
        else if (ui.view==='backup') h=`<div class="panel"><h2>Полное резервное копирование</h2>
            <p class="muted">В одном файле сохраняются настройки сервера, все устройства и привязки, схемы преобразований, OAuth-реквизиты, callback-настройки и действующие OAuth-токены.</p>
            <div class="hint"><b>Секретные данные!</b> Файл содержит пароли, OAuth Client Secret и токены доступа в открытом виде. Храни его в защищённом месте, не публикуй и не передавай посторонним.</div>
            <div class="button-row"><button type="button" class="btn" data-action="full-backup-export">↓ Скачать полный бэкап (.json)</button></div>
            <div class="divider-line"></div>
            <h2>Восстановление из файла</h2>
            <p class="muted">После переустановки адаптера создай и запусти экземпляр, затем загрузи созданный ранее файл. Все его настройки и OAuth-токены будут заменены, после восстановления адаптер перезапустится.</p>
            <div class="button-row"><button type="button" class="btn secondary" data-action="full-backup-import">↑ Выбрать файл для восстановления</button></div>
            <div class="hint"><b>Область восстановления:</b> только этот экземпляр Yandex UD Bridge. Файл не восстанавливает сам ioBroker, Zigbee/Tuya-адаптеры, JavaScript-скрипты, nginx или настройки навыка в Яндекс Диалогах. ID объектов ioBroker должны существовать в целевой системе.</div></div>`;
        else if (ui.view==='advanced') h=`<div class="panel"><h2>Расширенное логирование команд Яндекса</h2><p class="muted">При включении адаптер выводит в журнал ioBroker запрос Яндекса, выбранную привязку, преобразование, целевой State и результат записи.</p><div class="fields">${checkField('Включить подробный журнал команд (debug)','debugActions',d.debugActions)}</div><p class="hint">Строки помечены [YUD TRACE]. Используется уровень info, менять loglevel адаптера не нужно. OAuth-токены и пароли не записываются. После диагностики режим рекомендуется отключить.</p></div><div class="panel"><h2>Уведомления Яндексу об изменениях</h2><p class="muted">Необязательно. Без callback Яндекс опрашивает состояния через Provider API.</p><div class="fields">${checkField('Включить callback','callbackEnabled',d.callbackEnabled)}${textField('ID навыка Яндекса','callbackSkillId',d.callbackSkillId)}${textField('OAuth-токен для callback API Яндекса','callbackOauthToken',d.callbackOauthToken,{password:true})}</div><p class="hint">Callbacks запускаются только для функций с отметкой «Передавать события».</p></div>`;
        if (ui.view === 'diagnostic') h += `<div class="panel"><div class="detail-head"><div><h2>Диагностика OAuth и API</h2><p class="muted">Проверка на сервере ioBroker: вход, токены, refresh, список и чтение состояний.</p></div><button class="btn" data-action="oauth-diagnostic" ${ui.oauthDiagnosticBusy ? 'disabled' : ''}>${ui.oauthDiagnosticBusy ? 'Проверяем…' : 'Проверить подключение'}</button></div><div class="hint">Проверяются только локальные HTTP-маршруты. Проверка не обращается к Яндексу, не отправляет команды устройствам и не меняет действующие токены. HTTPS-доступ снаружи нужно проверить отдельно.</div><div id="oauth-diagnostic-results" aria-live="polite">${oauthDiagnosticMarkup()}</div></div>`;
        document.querySelector('#content').innerHTML=h;
    }
    function render() {
        document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('is-selected',n.dataset.view===ui.view));
        const detail=ui.view==='devices' && ui.selected!==null;
        const title=detail?'Настройка устройства':({devices:'Устройства',server:'Сервер и HTTPS',auth:'Авторизация',diagnostic:'Проверка',migration:'Импорт config.js',backup:'Резервная копия',advanced:'Дополнительно'}[ui.view]||'Устройства');
        document.querySelector('#page-heading').textContent=title;
        document.querySelector('#breadcrumb').textContent=detail?'МОИ УСТРОЙСТВА / РЕДАКТОР':title.toUpperCase();
        document.querySelector('#page-subtitle').textContent=detail?'Без таблиц и обязательного ручного JSON':'Устройства и привязки управляются прямо в ioBroker Admin';
        if (ui.view==='devices') detail?showDetail():showDevices(); else showSettings();
    }
    function locate(path) {
        const keys=path.split('.'); let obj=ui.data;
        for (let k=0;k<keys.length-1;k++) { if (!obj[keys[k]]) return null; obj=obj[keys[k]]; }
        return {obj,key:keys[keys.length-1]};
    }
    function onBind(target) {
        const found=locate(target.dataset.bind); if (!found) return;
        let val=target.type==='checkbox'?target.checked:target.value;
        if (target.dataset.bind==='listenPort') val=Number(val);
        const old=found.obj[found.key];
        found.obj[found.key]=val;
        const readToggle=target.dataset.bind.match(/^bindings\.(\d+)\.retrievable$/);
        if(readToggle) {
            const idx=Number(readToggle[1]),b=ui.data.bindings[idx];
            if(b?.kind==='capability' && b.type!=='video_stream') {
                const primary=mainObject(b);
                if(val && !b.stateId && primary && !hasSeparateFeedback(b) && b.commandMode!=='stop_only')b.stateId=primary;
                // For command-only devices keep their write state, but stop querying it.
                if(!val && !hasSeparateFeedback(b)) {b.commandId=primary;b.stateId='';}
            }
        }
        if (/^devices\.\d+\.id$/.test(target.dataset.bind) && old!==val) {
            for (const b of ui.data.bindings) if (b.deviceId===old) b.deviceId=val;
        }
        if (target.dataset.bind.endsWith('.stateId') || target.dataset.bind.endsWith('.commandId')) {
            const match=target.dataset.bind.match(/^bindings\.(\d+)\./);
            if (match && val) ui.data.bindings[Number(match[1])].enabled=true;
            const label=document.querySelector(`[data-state-help="${target.dataset.bind}"]`);
            if (label) label.textContent=stateLabel(val);
        }
        touch();
        if (target.tagName==='SELECT' || target.type==='checkbox') render();
    }
    function newDevice(templateIndex) {
        const t=templates[templateIndex], type=t ? t[0] : 'devices.types.other';
        const base=type.split('.').at(-1).replace(/[^a-z0-9_]/ig,'_');
        let id=base, n=2; while (ui.data.devices.some(d=>d.id===id)) id=base+'_'+n++;
        const dev={enabled:true,id,name:t?deviceType(type)[0]:'Новое устройство',room:'',type,description:'',onlineStateId:'',onlineInvert:false,onlineAlways:false};
        ui.data.devices.push(dev);
        for (const key of t?.[1]||[]) {
            const [type,instance] = key.split(':'); const kind=type==='float'||type==='event'?'property':'capability';
            const b=binding(id,kind,type,instance);
            if (dev.type==='devices.types.openable') {
                if(type==='on_off'){b.commandMode='enum_open_close';b.openValue='OPEN';b.closeValue='CLOSE';b.retrievable=false;}
                if(type==='toggle'&&instance==='pause'){b.commandMode='stop_only';b.stopValue='STOP';b.retrievable=false;}
            }
            ui.data.bindings.push(b);
        }
        ui.templates=false;ui.smartAdd=false;ui.selected=ui.data.devices.length-1;ui.editing=null;touch();render();
    }
    function click(action,index,target) {
        if (action==='oauth-generate') {
            if (!oauthSetup?.allEmpty(ui.data)) { notify('Уже есть OAuth-реквизиты. Автозамена запрещена, чтобы не отключить навык.', 'error'); return; }
            try {
                Object.assign(ui.data, oauthSetup.generate(window.crypto));
                ui.data.oauthUserId = String(ui.data.oauthUserId || '1');
                touch(); render();
                notify('Реквизиты сгенерированы локально. Нажми «Сохранить» в настройках экземпляра. До сохранения они не действуют.', 'ok');
            } catch(err) { notify(err.message, 'error'); }
        } else if (action==='oauth-reset-login') {
            if (ui.data.oauthPassword && typeof window.confirm === 'function' &&
                !window.confirm('Заменить пароль для входа? Старый пароль перестанет подходить для новой авторизации. Client ID и Client Secret Яндекса останутся без изменений.')) return;
            try {
                Object.assign(ui.data, oauthSetup.generateAccount(window.crypto, ui.data.oauthLogin));
                touch(); render();
                notify('Создан новый пароль для входа. Скопируй его и нажми «Сохранить» в настройках экземпляра. Client ID и Client Secret не изменены.', 'ok');
            } catch(err) { notify(err.message, 'error'); }
        } else if (action==='oauth-copy') {
            const allowed=['oauthClientId','oauthClientSecret','oauthLogin','oauthPassword'];
            if (!allowed.includes(target?.dataset.field)) return;
            oauthCopy(String(ui.data[target.dataset.field] || ''));
        } else if (action==='oauth-copy-all') {
            let urls;
            try { urls = oauthSetup?.addresses(ui.data.publicBaseUrl); }
            catch(err) { notify(err.message, 'error'); return; }
            if (!urls || !ui.data.oauthClientId || !ui.data.oauthClientSecret) { notify('Сначала настрой OAuth и публичный HTTPS-адрес.', 'error'); return; }
            const content = [
                'Идентификатор приложения: '+ui.data.oauthClientId,
                'Секрет приложения: '+ui.data.oauthClientSecret,
                'Endpoint URL: '+urls.provider,
                'URL авторизации: '+urls.authorize,
                'URL получения токена: '+urls.token,
                'URL обновления токена: '+urls.refresh
            ].join('\n');
            oauthCopy(content);
        }
        else if (action==='new') { ui.templates=true;ui.smartAdd=false;render(); }
        else if (action==='smart-add') { ui.smartAdd=true;ui.smartState='';ui.templates=false;render(); }
        else if (action==='hide-state') { ui.smartAdd=false;render(); }
        else if (action==='create-state') {
            const id=String(ui.smartState||'').trim();
            const c=ui.candidates.find(x=>x.id===id);
            if(!id){notify('Укажи состояние ioBroker','error');return;}
            const role=(c?.role||'').toLowerCase(),type=(c?.type||'').toLowerCase();
            let dt='devices.types.other',kind='capability',cap='on_off',instance='on';
            if(/window|door|contact|opening/.test(role)){dt='devices.types.sensor.open';kind='property';cap='event';instance='open';}
            else if(/temperature/.test(role)){dt='devices.types.sensor';kind='property';cap='float';instance='temperature';}
            else if(/humidity/.test(role)){dt='devices.types.sensor';kind='property';cap='float';instance='humidity';}
            else if(/blind|shutter|curtain/.test(role)){dt='devices.types.openable.curtain';cap='range';instance='open';}
            else if(/dimmer|brightness/.test(role)){dt='devices.types.light';cap='range';instance='brightness';}
            else if(/switch|light|button/.test(role) || type==='boolean'){dt='devices.types.light';cap='on_off';instance='on';}
            else if(type==='number'){dt='devices.types.sensor';kind='property';cap='float';instance='temperature';}
            // Prefer the assigned ioBroker function when the state role is generic.
            const categoryType=inferredType(id);
            if (categoryType && !/window|door|contact|opening|temperature|humidity|blind|shutter|curtain|dimmer|brightness/.test(role)) {
                dt=categoryType;
                if (categoryType==='devices.types.openable.curtain'){kind='capability';cap='range';instance='open';}
                else if(categoryType==='devices.types.openable'){kind='capability';cap='on_off';instance='on';}
                else if (categoryType==='devices.types.sensor.open'){kind='property';cap='event';instance='open';}
                else if (categoryType==='devices.types.sensor.motion'){kind='property';cap='event';instance='motion';}
                else if (categoryType==='devices.types.thermostat'&&type==='number'){kind='capability';cap='range';instance='temperature';}
                else if (categoryType==='devices.types.light'&&type==='number'){kind='capability';cap='range';instance='brightness';}
                else if (['devices.types.light','devices.types.socket','devices.types.vacuum_cleaner'].includes(categoryType)){kind='capability';cap='on_off';instance='on';}
            }
            let deviceId=id.replace(/[^a-z0-9_-]/ig,'_'),n=2,base=deviceId;while(ui.data.devices.some(d=>d.id===deviceId))deviceId=base+'_'+n++;
            const dev={id:deviceId,name:c?.name||id,room:'',type:dt,enabled:true,description:'',onlineStateId:'',onlineInvert:false,onlineAlways:false};
            autoRoom(dev,id);
            ui.data.devices.push(dev);const b=binding(deviceId,kind,cap,instance);b.enabled=true;b.stateId=id;if(kind==='capability'&&c?.write)b.commandId='';
            if(dt==='devices.types.openable' && cap==='on_off') {
                b.commandMode='enum_open_close';b.openValue='OPEN';b.closeValue='CLOSE';
                b.commandId=id;b.stateId='';b.retrievable=false;
            }
            ui.data.bindings.push(b);
            ui.smartAdd=false;ui.selected=ui.data.devices.length-1;ui.editing=ui.data.bindings.length-1;touch();render();
            notify('Тип и функция предложены по common.role. Проверь параметры и команды перед сохранением.','ok');
        }
        else if (action==='hide-templates') {ui.templates=false;render();}
        else if (action==='use-template') newDevice(Number(index));
        else if (action==='open') {ui.selected=Number(index);ui.editing=null;ui.tuyaCurtainState='';render();}
        else if (action==='back') {ui.selected=null;ui.editing=null;ui.tuyaCurtainState='';render();}
        else if (action==='toggle-function') {ui.editing=ui.editing===Number(index)?null:Number(index);render();}
        else if (action==='toggle-availability') {ui.editing=ui.editing==='availability'?null:'availability';render();}
        else if (action==='remove-availability') {
            if(!window.confirm('Удалить свойство «Доступность»? Привязка online будет очищена.'))return;
            const device=ui.data.devices[ui.selected];
            device.onlineStateId='';device.onlineInvert=false;device.onlineAlways=false;device.onlineEnabled=false;
            ui.editing=null;touch();render();
        }
        else if (action==='apply-tuya-curtain') applyTuyaCurtainPreset();
        else if (action==='delete-device') {
            const d=ui.data.devices[ui.selected];
            if (!window.confirm(`Удалить устройство «${d.name}» со всеми его функциями?`)) return;
            ui.data.bindings=ui.data.bindings.filter(b=>b.deviceId!==d.id);ui.data.devices.splice(ui.selected,1);ui.selected=null;touch();render();
        } else if (action==='duplicate') {
            const src=ui.data.devices[ui.selected], base=src.id+'_copy';let id=base,n=2;
            while(ui.data.devices.some(d=>d.id===id))id=base+n++;
            ui.data.devices.push({...copy(src),id,name:src.name+' (копия)'});
            for (const b of ui.data.bindings.filter(b=>b.deviceId===src.id))ui.data.bindings.push({...copy(b),deviceId:id});
            ui.selected=ui.data.devices.length-1;touch();render();
        } else if (action==='del-function') {if(!window.confirm('Удалить эту функцию?'))return;ui.data.bindings.splice(Number(index),1);ui.editing=null;touch();render();}
        else if (action==='add-function') {
            const selected=document.querySelector('#add-function-select').value;
            const f=available[Number(selected)];if(selected===''||!f)return;
            if(f[0]==='system' && f[1]==='online') {
                const device=ui.data.devices[ui.selected];
                if(hasAvailability(device)) { notify('Свойство «Доступность» уже добавлено.', 'error');return; }
                device.onlineEnabled=true;ui.editing='availability';touch();render();return;
            }
            if (ui.data.bindings.some(b=>b.deviceId===ui.data.devices[ui.selected].id && b.kind===f[0] && b.type===f[1] && b.instance===f[2])){notify('Такая функция уже существует','error');return;}
            ui.data.bindings.push(binding(ui.data.devices[ui.selected].id,...f.slice(0,3)));
            const newBinding=ui.data.bindings.at(-1);
            const device=ui.data.devices[ui.selected];
            if(['devices.types.openable','devices.types.openable.curtain'].includes(device.type)) {
                if(newBinding.type==='on_off') {
                    newBinding.commandMode='enum_open_close';newBinding.openValue='OPEN';newBinding.closeValue='CLOSE';
                    newBinding.retrievable=false;
                }
                if(newBinding.type==='toggle' && newBinding.instance==='pause') {
                    newBinding.commandMode='stop_only';newBinding.stopValue='STOP';newBinding.retrievable=false;
                    const original=ui.data.bindings.find(b=>b.deviceId===device.id && b.type==='on_off' && b.commandMode==='enum_open_close');
                    if(original?.commandId) newBinding.commandId=original.commandId;
                }
            }
            ui.editing=ui.data.bindings.length-1;touch();render();
        } else if (action==='full-backup-export') {
            if (bridgeMode !== 'settings') return;
            send('fullBackupExport', {}, backup => {
                if (backup?.format !== 'iobroker.yandex-ud-bridge.full-backup') {
                    notify('Получен неверный формат резервной копии.', 'error');return;
                }
                const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json'});
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                const date = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
                anchor.href=url;
                anchor.download=`yandex-ud-bridge-full-backup-${date}.json`;
                document.body.appendChild(anchor);
                anchor.click();anchor.remove();
                setTimeout(()=>URL.revokeObjectURL(url),1000);
                notify(`Создан полный бэкап: ${backup.native.devices.length} устройств, ${backup.native.bindings.length} функций. Не передавай файл посторонним.`, 'ok');
            });
        } else if (action==='full-backup-import') {
            if (bridgeMode !== 'settings') return;
            document.querySelector('#backup-file')?.click();
        } else if (action==='oauth-diagnostic') {
            if (ui.oauthDiagnosticBusy) return;
            ui.oauthDiagnosticBusy = true;
            ui.oauthDiagnostic = null;
            render();
            send('oauthDiagnostic', {}, answer => {
                ui.oauthDiagnosticBusy = false;
                ui.oauthDiagnostic = answer;
                if (ui.view === 'diagnostic') render();
            }, message => {
                ui.oauthDiagnosticBusy = false;
                ui.oauthDiagnostic = {ok:false, testedAt:new Date().toISOString(),steps:[{status:'error',title:'Ответ адаптера',message,elapsedMs:0}]};
                if (ui.view === 'diagnostic') render();
            });
        } else if (action==='preview') {
            const pre=document.querySelector('#preview-result');pre.textContent='Формируем JSON…';
            send('preview',{config:ui.data,userId:ui.data.oauthUserId},r=>{pre.textContent=JSON.stringify(r,null,2);});
        } else if (action==='import-file') document.querySelector('#config-file').click();
    }
    document.addEventListener('click',event=>{
        const conversionButton=event.target.closest('[data-transform-add],[data-transform-remove],[data-transform-mirror]');
        if(conversionButton){event.preventDefault();changeTransformRows(conversionButton);return;}
        const el=event.target.closest('[data-action]');if(!el)return;
        if(['expert','separate-feedback','room-choice'].includes(el.dataset.action))return;
        // A click inside the dialog must not bubble to the overlay's close action.
        if(el.dataset.action==='pick-state'){openNativePicker(el.dataset.path);return;}
        if(el.dataset.action==='clear-state'){setPickedState(el.dataset.path,'');return;}
        if(el.tagName==='INPUT' && el.type==='checkbox')return;
        event.preventDefault();click(el.dataset.action,el.dataset.index,el);
    });
    document.addEventListener('change',event=>{
        const target=event.target;
        if(target.dataset.mapRow!==undefined || target.dataset.transformParamRow!==undefined){updateTransformInput(target);return;}
        if(target.dataset.action==='room-choice') {
            const d=ui.data.devices[Number(target.dataset.deviceIndex)];if(!d)return;
            const value=target.value;
            const room=ui.categories.rooms.find(r=>r.id===value);
            if(room){d.room=room.name;d.roomEnumId=room.id;d.roomManual=false;}
            else if(value==='__legacy__')return; // Preserve an unmatched imported room.
            else {d.room='';d.roomEnumId='';d.roomManual=true;}
            touch();refreshRoomField();return;
        }
        if(target.dataset.action==='expert'){ui.expert=target.checked;render();return;}
        if(target.dataset.transformRow !== undefined) {
            const row=ui.data.bindings[Number(target.dataset.transformRow)];
            const key=target.dataset.transformDirection;
            if(!row || !['readTransform','writeTransform'].includes(key))return;
            if(key==='writeTransform' && ['enum_open_close','stop_only'].includes(target.value)) {
                row.commandMode=target.value;row.writeTransform='';
                if(target.value==='enum_open_close') {
                    row.openValue ??= 'OPEN';row.closeValue ??= 'CLOSE';
                    if(!hasSeparateFeedback(row)) {const main=mainObject(row);row.commandId=main;row.stateId='';row.retrievable=false;}
                }
                else {row.stopValue ??= 'STOP';row.retrievable=false;row.stateId='';}
            } else {
                if(key==='writeTransform')row.commandMode='direct';
                row[key]=target.value?JSON.stringify(transformDefaults[target.value]):'';
            }
            touch();render();return;
        }
        if(target.dataset.action==='separate-feedback') {
            const idx=Number(target.dataset.index),b=ui.data.bindings[idx];if(!b || b.kind!=='capability')return;
            const main=mainObject(b);
            if(target.checked) {ui.feedbackExtra.add(b);if(main && !b.commandId)b.commandId=main;}
            else {ui.feedbackExtra.delete(b);if(main){
                if(b.retrievable===false || b.commandMode==='stop_only'){b.commandId=main;b.stateId='';}
                else {b.commandId=main;b.stateId=main;}
            }}
            touch();render();return;
        }
        if(target.dataset.bind) onBind(target);
    });
    document.addEventListener('input',event=>{
        const target=event.target;
        if(target.id==='device-search'){ui.search=target.value; const pos=target.selectionStart;showDevices();const again=document.querySelector('#device-search');again.focus();again.setSelectionRange(pos,pos);return;}
        if(target.dataset.mapRow!==undefined || target.dataset.transformParamRow!==undefined){updateTransformInput(target);return;}
        if(target.dataset.bind && target.type!=='checkbox' && target.tagName!=='SELECT') onBind(target);
    });
    document.addEventListener('click',event=>{
        const nav=event.target.closest('[data-view]');if(!nav)return;
        ui.view=nav.dataset.view;ui.selected=null;ui.templates=false;ui.smartAdd=false;ui.editing=null;notify('');render();
    });
    document.addEventListener('change', async event=>{
        if (event.target.id !== 'backup-file') return;
        const file=event.target.files?.[0];event.target.value='';if(!file)return;
        if(file.size>8*1024*1024){notify('Файл резервной копии превышает 8 МБ.','error');return;}
        let backup;
        try {backup=JSON.parse(await file.text());}
        catch (err) {notify('Невозможно прочитать JSON резервной копии: '+err.message,'error');return;}
        if(backup?.format!=='iobroker.yandex-ud-bridge.full-backup' || backup?.schemaVersion!==1 ||
           !Array.isArray(backup?.native?.devices) || !Array.isArray(backup?.native?.bindings) ||
           !backup?.oauthTokens?.access || !backup?.oauthTokens?.refresh) {
            notify('Неподдерживаемый или неполный файл резервной копии.','error');return;
        }
        const approval=`Восстановить ${backup.native.devices.length} устройств и ${backup.native.bindings.length} функций из резервной копии ${backup.createdAt||''}?\n\n` +
            'Текущие настройки, OAuth-секреты и OAuth-токены ЭТОГО экземпляра будут заменены. Операция может перезапустить адаптер.\n\nПродолжить?';
        if(!window.confirm(approval))return;
        send('fullBackupRestore',{backup},result=>{
            notify(result?.message||'Резервная копия восстановлена. Обнови страницу после перезапуска экземпляра.','ok');
        },message=>notify('Ошибка восстановления: '+message,'error'));
    });
    document.addEventListener('change', async event=>{
        if (event.target.id !== 'config-file') return;
        const file=event.target.files?.[0];event.target.value='';if(!file)return;
        if(file.size>2*1024*1024){notify('Файл больше 2 МБ','error');return;}
        if(ui.data.devices.length && !confirm(`Текущие ${ui.data.devices.length} устройств будут заменены импортом. Продолжить?`))return;
        send('importFile',{source:await file.text()},result=>{
            if(!Array.isArray(result?.devices)){notify('Неверный результат импорта','error');return;}
            ui.data.devices=result.devices;
            ui.data.bindings=result.bindings;
            ui.view=bridgeMode==='settings'?'migration':'devices';ui.selected=null;ui.templates=false;ui.importPending=true;touch();render();
            notify(`Импортировано ${result.devices.length} устройств и ${result.bindings.length} функций. ${bridgeMode==='settings'?'Нажми «Сохранить» в настройках экземпляра, затем открой раздел «Яндекс Умный дом».':'Привяжи состояния ioBroker и сохрани изменения.'}`);
        });
    });
    window.load = (settings, onChange) => {
        ui.data=copy(settings || {});ui.data.devices=Array.isArray(ui.data.devices)?ui.data.devices:[];
        for (const device of ui.data.devices) delete device.allowedUsers;
        ui.data.bindings=Array.isArray(ui.data.bindings)?ui.data.bindings:[];
        ui.data.oauthUserId=String(ui.data.oauthUserId||'1');
        for(const obsolete of ['authMode','staticToken','staticUserId','legacyTokenFile','legacyConfigFile','mqttEnabled','mqttHost','mqttPort','mqttUser','mqttPassword','callbackUserId']) delete ui.data[obsolete];
        // Migration from v0.1: preserve descriptions, but never use old MQTT topics as live backend.
        for(const b of ui.data.bindings){if(b.backend==='mqtt'){b.migrationHint=[b.stateTopic,b.setTopic].filter(Boolean).join(' → ');b.backend='iobroker';b.stateId='';b.commandId='';b.enabled=false;}}
        ui.feedbackExtra=new WeakSet();ui.importPending=false;ui.changed=onChange;onChange(false);render();
        loadCandidates();
        loadCategories();
    };
    function validTransformConfig(raw) {
        if (!raw) return true;
        let t;
        try {t=JSON.parse(raw);} catch {return false;}
        if(!t||typeof t!=='object'||Array.isArray(t))return false;
        if(t.type==='boolean')return true;
        if(t.type==='lookup')return Array.isArray(t.pairs)&&t.pairs.length>0&&t.pairs.length<=256&&t.pairs.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>v!=='' && v!==null && v!==undefined)) && new Set(t.pairs.map(p=>JSON.stringify(p[0]))).size===t.pairs.length;
        if(t.type==='threshold')return typeof t.value==='number'&&Number.isFinite(t.value)&&['gt','gte','lt','lte','eq','neq'].includes(t.operator);
        if(t.type==='invert')return typeof t.max==='number'&&Number.isFinite(t.max);
        if(t.type==='scale')return ['from','to'].every(k=>Array.isArray(t[k])&&t[k].length===2&&t[k].every(v=>typeof v==='number'&&Number.isFinite(v)))&&t.from[0]!==t.from[1];
        return false;
    }
    window.save = callback => {
        const ids=new Set();
        for(const d of ui.data.devices){
            if(!d.id || ids.has(d.id)){notify(`Проверь ID устройства: ${d.id} (пустой или дублируется)`,'error');return;}
            ids.add(d.id);
        }
        for(const b of ui.data.bindings){
            if(!b.deviceId || !ids.has(b.deviceId)){notify('Есть функция без устройства','error');return;}
            for(const key of ['parameters','mapping','readTransform','writeTransform'])if(b[key])try{JSON.parse(b[key]);}catch{notify(`Некорректный JSON в ${b.deviceId}: ${key}`,'error');return;}
            for(const key of ['readTransform','writeTransform']) {
                if(!validTransformConfig(b[key])){notify(`Неверные параметры преобразования ${key} в ${b.deviceId}`,'error');return;}
            }
            if(b.type!=='video_stream'&&!b.stateId&&!b.commandId)b.enabled=false;
            if(b.kind==='capability' && b.enabled && b.type!=='video_stream' && !mainObject(b)){
                notify(`У функции ${b.deviceId}/${b.instance} не выбран основной объект управления.`,'error');return;
            }
            if(b.type!=='video_stream'&&!b.stateId)b.retrievable=false;
            if(b.commandMode==='stop_only')b.retrievable=false;
        }
        // Only one room selector is exposed in the UI. Persist the enum ID
        // and the corresponding Yandex-readable room name together.
        for(const d of ui.data.devices) {
            const room = resolvedRoom(d);
            if (room) { d.room = room.name; d.roomEnumId = room.id; d.roomManual = false; }
        }
        if (bridgeMode==='settings' && !ui.importPending) {
            // The separate Admin tab can update devices while settings are open.
            // Do not overwrite newer device data when saving HTTP/OAuth options.
            const sock=window.socket;
            if (!sock || typeof sock.emit!=='function') {
                notify('Нет связи с ioBroker: сохранение остановлено, чтобы не перезаписать устройства.','error');
                return;
            }
            let ended=false;
            const timeout=setTimeout(()=>{
                if(!ended){ended=true;notify('Не удалось прочитать актуальные устройства. Настройки не сохранены.','error');}
            },10000);
            sock.emit('getObject',instanceId().replace(/^/,'system.adapter.'),(err,obj)=>{
                if(ended)return;
                ended=true;clearTimeout(timeout);
                if(err || !obj?.native || !Array.isArray(obj.native.devices) || !Array.isArray(obj.native.bindings)) {
                    notify('Не удалось проверить актуальную конфигурацию экземпляра. Сохранение отменено.','error');return;
                }
                ui.data.devices=copy(obj.native.devices);
                for (const device of ui.data.devices) delete device.allowedUsers;
                ui.data.bindings=copy(obj.native.bindings);
                callback(ui.data);
            });
        } else callback(ui.data);
    };
})();
