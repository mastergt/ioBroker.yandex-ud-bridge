'use strict';
// UI-only preset builder. Runtime continues to use the existing `scale` transform.
// Pressure units are represented by their exact number of pascals.
(function (root) {
    const UNITS = Object.freeze({
        pa:   { label: 'Па (Pa)',           pascal: 1 },
        hpa:  { label: 'гПа (hPa)',         pascal: 100 },
        kpa:  { label: 'кПа (kPa)',         pascal: 1000 },
        mmhg: { label: 'мм рт. ст. (mmHg)', pascal: 133.322387415 },
        bar:  { label: 'бар (bar)',         pascal: 100000 },
        atm:  { label: 'атм (atm)',         pascal: 101325 }
    });
    const YANDEX = Object.freeze({
        mmhg: 'unit.pressure.mmhg',
        pa: 'unit.pressure.pascal',
        bar: 'unit.pressure.bar',
        atm: 'unit.pressure.atm'
    });
    const inputKeys = Object.keys(UNITS);
    const outputKeys = Object.keys(YANDEX);
    function preset(input, output) {
        if (!Object.hasOwn(UNITS, input) || !Object.hasOwn(YANDEX, output)) {
            throw new Error('Неподдерживаемые единицы давления');
        }
        // Scale from zero to one input unit, avoiding hard-coded sampling ranges.
        // The generic transform works for readings outside of any normal pressure range.
        const factor = UNITS[input].pascal / UNITS[output].pascal;
        return {
            unit: YANDEX[output],
            readTransform: {type: 'scale', from: [0, 1], to: [0, factor]}
        };
    }
    function recognize(parameters, readTransform) {
        let p = parameters, t = readTransform;
        try { if (typeof p === 'string') p = JSON.parse(p); } catch { return null; }
        try { if (typeof t === 'string') t = JSON.parse(t); } catch { return null; }
        if (!p || typeof p !== 'object' || !t || t.type !== 'scale' ||
            !Array.isArray(t.from) || !Array.isArray(t.to) || t.from.length !== 2 || t.to.length !== 2 ||
            !t.from.every(Number.isFinite) || !t.to.every(Number.isFinite) || t.from[0] === t.from[1]) return null;
        const output = outputKeys.find(id => YANDEX[id] === p.unit);
        if (!output) return null;
        const slope = (t.to[1] - t.to[0]) / (t.from[1] - t.from[0]);
        const offset = t.to[0] - t.from[0] * slope;
        if (Math.abs(offset) > 1e-8 || !Number.isFinite(slope)) return null;
        const input = inputKeys.find(id => {
            const expected = UNITS[id].pascal / UNITS[output].pascal;
            return Math.abs(slope - expected) < 1e-6 * Math.max(1, Math.abs(expected));
        });
        return input ? {input, output} : null;
    }
    const api = Object.freeze({ UNITS, YANDEX, inputKeys, outputKeys, preset, recognize });
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.YudPressureUnits = api;
})(typeof window === 'object' ? window : null);
