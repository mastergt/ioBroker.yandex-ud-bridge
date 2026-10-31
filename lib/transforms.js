'use strict';

// Optional, one-way transformations for ioBroker -> Yandex and Yandex -> ioBroker.
// A missing transform keeps the v0.3.5 value mapping behavior unchanged.
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function parseTransform(input) {
    if (input == null || input === '') return null;
    let result = input;
    if (typeof input === 'string') {
        try { result = JSON.parse(input); }
        catch { throw new Error('Некорректный JSON преобразования'); }
    }
    if (!isObject(result)) throw new Error('Преобразование должно быть объектом JSON');
    return result;
}
function finite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Некорректное число ${name}`);
    return value;
}
function validateTransform(input) {
    const t = parseTransform(input);
    if (!t) return null;
    if (t.type === 'boolean') return t;
    if (t.type === 'lookup') {
        if (!Array.isArray(t.pairs) || !t.pairs.length || t.pairs.length > 256 ||
            !t.pairs.every(pair => Array.isArray(pair) && pair.length === 2)) {
            throw new Error('lookup: pairs должен содержать пары [вход, выход]');
        }
        return t;
    }
    if (t.type === 'threshold') {
        finite(t.value, 'threshold.value');
        if (!['gt','gte','lt','lte','eq','neq'].includes(t.operator)) throw new Error('threshold: неизвестный operator');
        return t;
    }
    if (t.type === 'invert') {
        finite(t.max, 'invert.max');
        return t;
    }
    if (t.type === 'scale') {
        if (!Array.isArray(t.from) || t.from.length !== 2 || !Array.isArray(t.to) || t.to.length !== 2) {
            throw new Error('scale: ожидаются диапазоны from и to');
        }
        t.from.forEach(v => finite(v, 'scale.from'));
        t.to.forEach(v => finite(v, 'scale.to'));
        if (t.from[0] === t.from[1]) throw new Error('scale: начальный диапазон не может быть нулевым');
        return t;
    }
    throw new Error(`Неизвестный тип преобразования: ${t.type}`);
}
function boolFromState(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v !== 'string') return undefined;
    const word=v.trim().toLowerCase();
    if (['true','1','on','yes','open','opened'].includes(word)) return true;
    if (['false','0','off','no','close','closed'].includes(word)) return false;
    return undefined;
}
function applyTransform(value, config) {
    const t = validateTransform(config);
    if (!t || value === undefined || value === null || value === '') return value === '' && t ? undefined : value;
    switch (t.type) {
        case 'boolean': return boolFromState(value);
        case 'lookup': {
            const pair=t.pairs.find(item => equal(item[0],value));
            if (!pair) throw new Error(`Нет соответствия для значения ${JSON.stringify(value)}`);
            return pair[1];
        }
        case 'threshold': {
            const x=Number(value);
            if (!Number.isFinite(x)) throw new Error('Ожидалось числовое значение для threshold');
            switch(t.operator) {
                case 'gt': return x > t.value;
                case 'gte': return x >= t.value;
                case 'lt': return x < t.value;
                case 'lte': return x <= t.value;
                case 'eq': return x === t.value;
                case 'neq': return x !== t.value;
            }
            break;
        }
        case 'invert': {
            const x=Number(value);
            if (!Number.isFinite(x)) throw new Error('Ожидалось числовое значение для invert');
            return t.max-x;
        }
        case 'scale': {
            const x=Number(value);
            if (!Number.isFinite(x)) throw new Error('Ожидалось числовое значение для scale');
            return t.to[0]+(x-t.from[0])*(t.to[1]-t.to[0])/(t.from[1]-t.from[0]);
        }
    }
    return value;
}
module.exports={parseTransform,validateTransform,applyTransform};
