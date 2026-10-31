'use strict';
/** Literal-only JS object parser for `module.exports = { ... }` legacy config.
 *  No eval, vm, function calls or property access is permitted. */
function parseLegacy(source) {
    if (typeof source !== 'string' || source.length > 2 * 1024 * 1024) throw Error('Файл больше 2 МБ');
    let s = source.replace(/^\uFEFF/, '');
    const match = /^\s*module\s*\.\s*exports\s*=/.exec(s);
    if (!match) throw Error('Ожидался формат module.exports = {...}');
    let i = match[0].length, depth = 0;
    function space() {
        while (i < s.length) {
            if (/\s/.test(s[i])) { i++; continue; }
            if (s.slice(i, i+2) === '//') { i = s.indexOf('\n', i+2); if (i === -1) i = s.length; continue; }
            if (s.slice(i, i+2) === '/*') { const end = s.indexOf('*/', i+2); if (end === -1) throw Error('Незакрытый комментарий'); i = end+2; continue; }
            break;
        }
    }
    function word() { const m = /^[a-zA-Z_$][\w$-]*/.exec(s.slice(i)); if (!m) throw Error(`Ожидалось имя поля на ${i}`); i += m[0].length; return m[0]; }
    function quoted() {
        const quote = s[i++]; let result = '';
        while (i < s.length) {
            const ch = s[i++]; if (ch === quote) return result;
            if (ch !== '\\') { result += ch; continue; }
            const esc = s[i++];
            if (esc === 'u') { const hex = s.slice(i, i+4); if (!/^[\da-f]{4}$/i.test(hex)) throw Error('Некорректный unicode'); result += String.fromCharCode(parseInt(hex,16)); i += 4; }
            else if ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'}[esc] !== undefined) result += {n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'}[esc];
            else if (esc === '\n') {} else result += esc;
        }
        throw Error('Незакрытая строка');
    }
    function value() {
        space(); if (++depth > 70) throw Error('Слишком большая вложенность');
        let result;
        const c = s[i];
        if (c === '"' || c === "'") result = quoted();
        else if (c === '[') {
            result = []; i++; space();
            while (s[i] !== ']') { if (i >= s.length) throw Error('Незакрытый массив'); result.push(value()); space(); if (s[i] === ',') { i++; space(); } else if (s[i] !== ']') throw Error(`Ожидалась запятая на ${i}`); }
            i++;
        } else if (c === '{') {
            result = {}; i++; space();
            while (s[i] !== '}') {
                if (i >= s.length) throw Error('Незакрытый объект');
                const key = s[i] === '"' || s[i] === "'" ? quoted() : word();
                space(); if (s[i++] !== ':') throw Error('Ожидалось двоеточие');
                const v = value(); if (!['__proto__','prototype','constructor'].includes(key)) Object.defineProperty(result, key, { value: v, enumerable: true, writable: true, configurable: true });
                space(); if (s[i] === ',') { i++; space(); } else if (s[i] !== '}') throw Error(`Ожидалась запятая на ${i}`);
            }
            i++;
        } else if (c === '-' || /\d/.test(c || '')) {
            const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i)); if (!m) throw Error('Неверное число'); i += m[0].length; result = Number(m[0]);
        } else { const w = word(); if (w === 'true') result = true; else if (w === 'false') result = false; else if (w === 'null') result = null; else throw Error(`Недопустимое выражение: ${w}`); }
        depth--; return result;
    }
    const data = value(); space(); if (s[i] === ';') { i++; space(); }
    if (i !== s.length) throw Error('Лишний исполняемый код после объекта');
    if (!data || typeof data !== 'object' || !Array.isArray(data.devices)) throw Error('Нет массива devices');
    return data;
}
function convertLegacy(config) {
    const devices = [], bindings = [], warnings = []; const used = new Set();
    for (const d of config.devices || []) {
        if (!d.id || used.has(String(d.id))) { warnings.push('Пропущен повторяющийся ID'); continue; }
        used.add(String(d.id));
        devices.push({ enabled: true, id: String(d.id), name: d.name || String(d.id), room: d.room || '', description: d.description || '', type: d.type || 'devices.types.other' });
        for (const [kind, entries] of [['capability', d.capabilities || []], ['property', d.properties || []]]) for (const p of entries) {
            const type = String(p.type || '').split('.').at(-1);
            const instance = p.state?.instance || p.parameters?.instance || (type === 'video_stream' ? 'get_stream' : 'on');
            const mqtt = (d.mqtt || []).find(m => m.instance === instance) || {};
            const mapping = (d.valueMapping || []).find(m => m.type === type);
            bindings.push({ enabled: type === 'video_stream', deviceId: String(d.id), kind, type, instance,
                backend: 'iobroker', stateId: '', commandId: '', retrievable: p.retrievable !== false,
                reportable: !!p.reportable, parameters: p.parameters ? JSON.stringify(p.parameters) : '',
                mapping: mapping ? JSON.stringify(mapping.mapping) : '',
                streamUrl: type === 'video_stream' ? (p.state?.value?.stream_url || '') : '',
                migrationHint: [mqtt.state || '', mqtt.set || ''].filter(Boolean).join(' → ') });
        }
    }
    warnings.push('MQTT-привязки намеренно не перенесены: выберите ioBroker States для функций. Старые топики показаны как подсказки.');
    return { devices, bindings, warnings };
}
module.exports = { parseLegacy, convertLegacy };
