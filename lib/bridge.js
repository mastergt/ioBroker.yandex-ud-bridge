'use strict';

const { applyTransform } = require('./transforms');
const { traceAction, safeTraceValue } = require('./action-trace');


const DEVICE_TYPES = [
    'light', 'socket', 'switch', 'sensor', 'sensor.open', 'sensor.motion',
    'openable', 'openable.curtain', 'vacuum_cleaner', 'camera', 'thermostat', 'humidifier',
    'air_conditioner', 'fan', 'purifier', 'kettle', 'other', 'media_device.tv'
];
const CAP_TYPES = ['on_off', 'range', 'mode', 'toggle', 'color_setting', 'video_stream'];
const PROP_TYPES = ['float', 'event'];
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const parseJson = (raw, fallback = {}) => {
    if (isObject(raw) || Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== 'string') return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
};
const booleanValue = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return ['on','true','1','yes','open','opened'].includes(String(v).toLowerCase());
};
const compare = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function usesOnlineState(device) {
    return device.onlineEnabled !== false && device.onlineAlways !== true && !!device.onlineStateId;
}

function isOnline(value, invert = false) {
    // Unknown/missing availability is treated as unreachable when the user explicitly assigned an online state.
    if (value === undefined || value === null || value === '') return false;
    let online;
    if (typeof value === 'boolean') online = value;
    else if (typeof value === 'number') online = value !== 0;
    else {
        const normalized = String(value).trim().toLowerCase();
        if (['false','0','off','offline','disconnected','unavailable','no','down'].includes(normalized)) online = false;
        else if (['true','1','on','online','connected','available','yes','up'].includes(normalized)) online = true;
        else return false;
    }
    return invert ? !online : online;
}


function valueMapping(value, row, direction) {
    const map = parseJson(row.mapping, null);
    if (!map || !Array.isArray(map) || map.length !== 2) return value;
    const [yValues, localValues] = map;
    if (!Array.isArray(yValues) || !Array.isArray(localValues)) return value;
    const from = direction === 'toLocal' ? yValues : localValues;
    const to = direction === 'toLocal' ? localValues : yValues;
    const pos = from.findIndex(item => compare(item, value) || String(item) === String(value));
    return pos === -1 || pos >= to.length ? value : to[pos];
}
function toYandex(rawValue, row) {
    // Gate/curtain commands are write-only by default. Do not interpret STOP
    // or an unknown motor state as a false/closed boolean.
    if (row.commandMode === 'enum_open_close' && row.type === 'on_off' && !row.readTransform) {
        if (rawValue === null || rawValue === undefined || rawValue === '') return undefined;
        const val = String(rawValue).trim().toLowerCase();
        if (val === String(row.openValue ?? 'OPEN').trim().toLowerCase()) return true;
        if (val === String(row.closeValue ?? 'CLOSE').trim().toLowerCase()) return false;
        return typeof rawValue === 'boolean' ? rawValue : undefined;
    }
    if (row.commandMode === 'stop_only' && row.type === 'toggle' && row.instance === 'pause') return undefined;
    let val = row.readTransform ? applyTransform(rawValue, row.readTransform) : valueMapping(rawValue, row, 'toYandex');
    if (val === undefined || val === null) return undefined;
    switch (row.type) {
        case 'on_off': case 'toggle': return booleanValue(val);
        case 'range': case 'float': {
            if (val === null || val === '' || val === undefined) return undefined;
            const num = Number(val); return Number.isFinite(num) ? num : undefined;
        }
        case 'color_setting': {
            if (row.instance === 'hsv') {
                if (typeof val === 'string') val = parseJson(val, undefined);
                return isObject(val) ? val : undefined;
            }
            if (row.instance === 'temperature_k') {
                const num = Number(val); return Number.isFinite(num) ? num : undefined;
            }
            return val;
        }
        case 'event': {
            if (val === undefined || val === null) return undefined;
            const word = String(val).toLowerCase();
            const boolWords = ['true','false','1','0','on','off'];
            if (boolWords.includes(word)) {
                const active = ['true','1','on'].includes(word);
                if (row.instance === 'open') return active ? 'opened' : 'closed';
                if (row.instance === 'water_leak') return active ? 'leak' : 'dry';
                if (row.instance === 'motion' || row.instance === 'smoke') return active ? 'detected' : 'not_detected';
            }
            return String(val);
        }
        case 'mode': return val === undefined || val === null ? undefined : String(val);
        default: return val;
    }
}
// Numeric commands entered in Admin are sent as actual numbers to ioBroker.
// Text commands such as OPEN/CLOSE/STOP remain strings.
function typedCommand(raw) {
    if (typeof raw !== 'string') return raw;
    const text = raw.trim();
    if (/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))) {
        return Number(text);
    }
    return raw;
}
function fromYandex(value, row) {
    if (row.commandMode === 'enum_open_close' && row.type === 'on_off') {
        return typedCommand(value ? (row.openValue ?? 'OPEN') : (row.closeValue ?? 'CLOSE'));
    }
    if (row.commandMode === 'stop_only' && row.type === 'toggle' && row.instance === 'pause') {
        return typedCommand(row.stopValue ?? 'STOP');
    }
    return row.writeTransform ? applyTransform(value, row.writeTransform) : valueMapping(value, row, 'toLocal');
}
function validateAction(value, row) {
    if (value === undefined || value === null) return false;
    if (row.commandMode === 'stop_only' && row.type === 'toggle' && row.instance === 'pause' && value !== true) return false;
    if (row.type === 'range') {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        const range = parseJson(row.parameters).range;
        if (range && (value < range.min || value > range.max)) return false;
    }
    if (row.type === 'mode') {
        if (typeof value !== 'string') return false;
        const modes = parseJson(row.parameters).modes;
        if (Array.isArray(modes) && !modes.some(mode => mode.value === value)) return false;
    }
    if (['on_off','toggle'].includes(row.type) && typeof value !== 'boolean') return false;
    if (row.type === 'color_setting') {
        if (row.instance === 'temperature_k' && (typeof value !== 'number' || !Number.isFinite(value))) return false;
        if (row.instance === 'hsv' && !isObject(value)) return false;
    }
    return true;
}
function bindingKey(row) { return [String(row.deviceId), row.kind, row.type, row.instance || 'on'].join('|'); }
function descriptionType(row) { return `devices.${row.kind === 'property' ? 'properties' : 'capabilities'}.${row.type}`; }
function capabilityDefinition(row) {
    const type = descriptionType(row);
    const result = { type, retrievable: row.type === 'video_stream' || row.commandMode === 'stop_only' || (row.commandMode === 'enum_open_close' && !row.stateId) ? false : row.retrievable !== false,
        reportable: row.type === 'video_stream' ? false : !!row.reportable };
    let parameters = parseJson(row.parameters);
    if (!isObject(parameters)) parameters = {};
    switch (row.type) {
        case 'on_off':
            // Stateless gate controls need independent OPEN and CLOSE actions in Yandex.
            // Yandex recommends split=true when retrievable=false for openables.
            if (row.commandMode === 'enum_open_close' && !result.retrievable) {
                parameters = { ...parameters, split: true };
            }
            break;
        case 'range':
            parameters = { instance: row.instance || 'brightness', unit: 'unit.percent',
                range: { min: 0, max: 100, precision: 1 }, ...parameters }; break;
        case 'mode':
            parameters = { instance: row.instance || 'work_speed', modes: [{ value: 'auto' }], ...parameters }; break;
        case 'toggle': parameters = { instance: row.instance || 'pause', ...parameters }; break;
        case 'color_setting': parameters = { temperature_k: { min: 2700, max: 6500 }, ...parameters }; break;
        case 'video_stream': parameters = { protocols: ['hls'], ...parameters }; break;
        case 'float': parameters = { instance: row.instance || 'temperature', unit: 'unit.temperature.celsius', ...parameters }; break;
        case 'event': parameters = { instance: row.instance || 'open', events: [{ value: 'opened' }, { value: 'closed' }], ...parameters }; break;
    }
    if (Object.keys(parameters).length) result.parameters = parameters;
    return result;
}

class Bridge {
    constructor(config, transport, log = console) {
        this.config = config;
        this.transport = transport;
        this.log = log;
        this.devices = new Map();
        this.bindings = new Map();
        this.localIndex = new Map();
        this.mqttIndex = new Map();
        this.cache = new Map();
        this.onlineIndex = new Map();
        this.onlineCache = new Map();
        for (const d of config.devices || []) {
            if (d.enabled === false || !d.id || this.devices.has(String(d.id))) continue;
            this.devices.set(String(d.id), d);
            if(usesOnlineState(d)){ const names=this.onlineIndex.get(d.onlineStateId)||[];names.push(String(d.id));this.onlineIndex.set(d.onlineStateId,names); }
        }
        for (const row of config.bindings || []) {
            if (row.enabled === false || !this.devices.has(String(row.deviceId))) continue;
            if (row.type !== 'video_stream' && !row.stateId && !row.commandId) continue;
            if (!CAP_TYPES.includes(row.type) && !PROP_TYPES.includes(row.type)) continue;
            if ((row.kind === 'property') !== PROP_TYPES.includes(row.type)) {
                this.log.warn(`Wrong binding kind for ${row.deviceId}/${row.type}`); continue;
            }
            const b = { ...row, deviceId: String(row.deviceId), kind: row.kind === 'property' ? 'property' : 'capability',
                instance: row.instance || (row.type === 'on_off' ? 'on' : 'on') };
            const key = bindingKey(b);
            if (this.bindings.has(key)) { this.log.warn(`Duplicate binding ${key}`); continue; }
            this.bindings.set(key, b);
            const src = b.stateId;
            if (src) {
                const ix = this.localIndex;
                const keys = ix.get(src) || [];
                keys.push(key);
                ix.set(src, keys);
            }
        }
    }
    isVisible(d, userId) {
        // One OAuth account per adapter instance. Per-device allowedUsers was a
        // yandex2mqtt legacy ACL and must not suppress otherwise enabled devices.
        return d.enabled !== false && String(userId) === String(this.config.oauthUserId || '1');
    }
    visibleDevices(userId) { return [...this.devices.values()].filter(d => this.isVisible(d, userId)); }
    bindingsOf(id) { return [...this.bindings.values()].filter(b => b.deviceId === String(id)); }
    discover(userId) {
        return this.visibleDevices(userId).filter(d => this.bindingsOf(d.id).length > 0).map(d => {
            const rows = this.bindingsOf(d.id);
            const info = { id: String(d.id), name: d.name || String(d.id), type: d.type || 'devices.types.other',
                status_info: { reportable: !!(usesOnlineState(d) && this.config.callbackEnabled && this.config.callbackSkillId && this.config.callbackOauthToken) },
                capabilities: rows.filter(b => b.kind === 'capability').map(capabilityDefinition),
                properties: rows.filter(b => b.kind === 'property').map(capabilityDefinition) };
            if (d.room) info.room = d.room;
            if (d.description) info.description = d.description;
            return info;
        });
    }
    async deviceOnline(d) {
        if (!usesOnlineState(d)) return true;
        try { return isOnline(await this.transport.getState(d.onlineStateId), d.onlineInvert); }
        catch(e) { this.log.debug?.(`Cannot read online state ${d.onlineStateId}: ${e.message}`); return false; }
    }
    async readRow(b) {
        const key = bindingKey(b);
                if (!b.stateId) return this.cache.get(key);
        const val = await this.transport.getState(b.stateId);
        return val == null ? undefined : val;
    }
    async query(userId, requested) {
        const visible = new Map(this.visibleDevices(userId).map(d => [String(d.id), d]));
        const output = [];
        for (const req of requested) {
            const id = String(req.id);
            const d = visible.get(id);
            if (!d) { output.push({ id, error_code: 'DEVICE_NOT_FOUND' }); continue; }
            if (!(await this.deviceOnline(d))) { output.push({ id, error_code: 'DEVICE_UNREACHABLE' }); continue; }
            const result = { id };
            const caps = [], props = [];
            let failures = 0, success = 0;
            for (const row of this.bindingsOf(id)) {
                if (row.retrievable === false || row.type === 'video_stream') continue;
                try {
                    const value = toYandex(await this.readRow(row), row);
                    if (value === undefined) { failures++; continue; }
                    const target = row.kind === 'property' ? props : caps;
                    target.push({ type: descriptionType(row), state: { instance: row.instance, value } });
                    success++;
                } catch (err) { failures++; this.log.debug(`Cannot read ${id}/${row.instance}: ${err.message}`); }
            }
            if (caps.length) result.capabilities = caps;
            if (props.length) result.properties = props;
            if (failures && !success) result.error_code = 'DEVICE_UNREACHABLE';
            output.push(result);
        }
        return output;
    }
    async action(userId, requested, context = {}) {
        const trace = (deviceId, stage, detail) => traceAction(this.config, this.log, context.requestId, deviceId, stage, detail);
        const visible = new Map(this.visibleDevices(userId).map(d => [String(d.id), d]));
        const output = [];
        for (const req of requested) {
            const id = String(req.id);
            trace(id, 'DEVICE', `capabilities=${Array.isArray(req.capabilities) ? req.capabilities.length : 0} visible=${visible.has(id)}`);
            if (!visible.has(id)) {
                trace(id, 'REJECT', 'device not found or not available to OAuth user');
                this.log.warn?.(`Yandex action rejected: unknown device ${id}`);
                output.push({ id, action_result: { status: 'ERROR', error_code: 'DEVICE_NOT_FOUND' } }); continue;
            }
            if (!(await this.deviceOnline(visible.get(id)))) {
                trace(id, 'REJECT', 'online state reports unavailable');
                this.log.warn?.(`Yandex action rejected: device offline ${id}`);
                output.push({ id, action_result: { status: 'ERROR', error_code: 'DEVICE_UNREACHABLE' } }); continue;
            }
            const caps = [];
            for (const c of req.capabilities || []) {
                const instance = c?.state?.instance || 'on';
                const type = String(c.type || '').split('.').at(-1);
                const row = this.bindings.get([id,'capability',type,instance].join('|'));
                trace(id, 'RECEIVE', `capability=${c.type} instance=${instance} value=${safeTraceValue(c?.state?.value)} binding=${row ? 'found' : 'missing'}`);
                let outcome;
                if (!row) {
                    trace(id, 'REJECT', `binding missing: ${type}/${instance}`);
                    this.log.warn?.(`Yandex action rejected: binding not found for ${id}/${type}/${instance}`);
                    outcome = { status: 'ERROR', error_code: 'INVALID_ACTION' };
                }
                else {
                    try {
                        if (type !== 'video_stream' && !validateAction(c.state?.value, row)) {
                            trace(id, 'REJECT', `invalid value=${safeTraceValue(c.state?.value)} for ${type}/${instance}`);
                            this.log.warn?.(`Yandex action rejected: invalid value for ${id}/${type}/${instance}: ${JSON.stringify(c.state?.value)}`);
                            caps.push({ type: c.type, state: { instance, action_result: { status: 'ERROR', error_code: 'INVALID_VALUE' } } });
                            continue;
                        }
                        if (type === 'video_stream') {
                            trace(id, 'VIDEO', 'video stream setup requested (URL hidden)');
                            const url = row.streamUrl || parseJson(row.parameters).stream_url;
                            if (!url) throw new Error('No HLS URL configured');
                            outcome = { status: 'DONE' };
                            caps.push({ type: c.type, state: { instance, value: { protocol: 'hls', stream_url: url }, action_result: outcome } });
                            continue;
                        }
                        const target = row.commandId || row.stateId;
                        const mode = row.commandMode || (row.writeTransform ? 'writeTransform' : row.mapping ? 'mapping' : 'direct');
                        trace(id, 'BINDING', `read=${row.stateId || '(none)'} write=${target || '(none)'} mode=${mode}`);
                        const value = fromYandex(c.state?.value, row);
                        trace(id, 'TRANSFORM', `input=${safeTraceValue(c.state?.value)} output=${safeTraceValue(value)} mode=${mode}`);
                        if (!this.config.debugActions && (row.commandMode === 'enum_open_close' || row.commandMode === 'stop_only')) {
                            this.log.info?.(`Yandex motor command: device=${id}, capability=${type}/${instance}, state=${target}, value=${JSON.stringify(value)}`);
                        }
                        if (!target) throw new Error('No command state selected');
                        if (value === undefined) throw new Error('Command conversion returned undefined');
                        trace(id, 'WRITE', `setForeignStateAsync state=${target} val=${safeTraceValue(value)} ack=false`);
                        await this.transport.setState(target, value);
                        outcome = { status: 'DONE' };
                        trace(id, 'RESULT', 'setForeignStateAsync resolved; Yandex status=DONE; physical device operation NOT verified');
                        if (!this.config.debugActions && (row.commandMode === 'enum_open_close' || row.commandMode === 'stop_only')) {
                            this.log.info?.(`Yandex motor command submitted: device=${id}, value=${JSON.stringify(value)}`);
                        }
                    } catch (e) {
                        trace(id, 'ERROR', `capability=${type}/${instance} error=${e.message}`);
                        this.log.warn(`Action failed for ${id}/${instance}: ${e.message}`);
                        outcome = { status: 'ERROR', error_code: 'INTERNAL_ERROR' };
                    }
                }
                trace(id, 'YANDEX', `capability=${type}/${instance} result=${outcome?.status || 'UNKNOWN'}${outcome?.error_code ? ' code=' + outcome.error_code : ''}`);
                caps.push({ type: c.type, state: { instance, action_result: outcome } });
            }
            output.push({ id, capabilities: caps });
        }
        return output;
    }
    async onStateChange(source, val) {
        const keys = this.localIndex.get(source) || [];
        const changed = new Map();
        for (const deviceId of this.onlineIndex.get(source) || []) {
            const d = this.devices.get(deviceId);
            const status = isOnline(val, d.onlineInvert) ? 'online' : 'offline';
            if (this.onlineCache.get(deviceId) !== status) {
                this.onlineCache.set(deviceId,status);
                changed.set(deviceId, { id:deviceId, status, capabilities:[], properties:[] });
            }
        }
        for (const key of keys) {
            const b = this.bindings.get(key);
            let next;
            try { next = toYandex(val, b); }
            catch (err) { this.log.warn(`Cannot convert state ${source} for ${b.deviceId}/${b.instance}: ${err.message}`); continue; }
            if (next === undefined) continue;
            const previous = this.cache.get(key);
            this.cache.set(key, val);
            if (compare(previous, val) || !b.reportable) continue;
            const item = changed.get(b.deviceId) || { id: b.deviceId, capabilities: [], properties: [] };
            // Do not report an outdated value when an explicit online state indicates offline.
            if(!(await this.deviceOnline(this.devices.get(b.deviceId))))continue;
            item[b.kind === 'property' ? 'properties' : 'capabilities'].push({ type: descriptionType(b), state: { instance: b.instance, value: next } });
            changed.set(b.deviceId, item);
        }
        return [...changed.values()];
    }
}
module.exports = { Bridge, DEVICE_TYPES, CAP_TYPES, PROP_TYPES, toYandex, fromYandex, isOnline, capabilityDefinition, parseJson };
