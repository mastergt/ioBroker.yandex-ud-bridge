'use strict';
const { createHash } = require('node:crypto');
const { validateTransform } = require('./transforms');

/** Deliberately excludes all OAuth credentials and instance-private options. */
function editable(native = {}) {
    return {
        devices: Array.isArray(native.devices) ? native.devices.map(device => {
            if (!validPlainObject(device)) return device;
            const { allowedUsers, ...rest } = device;
            return rest;
        }) : [],
        bindings: Array.isArray(native.bindings) ? native.bindings : []
    };
}
function revision(native) {
    const { devices, bindings } = editable(native);
    return createHash('sha256').update(JSON.stringify({ devices, bindings })).digest('hex');
}
function validPlainObject(item) {
    return item !== null && typeof item === 'object' && !Array.isArray(item) &&
        (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
}
function validatedChange(input, currentRevision) {
    if (!validPlainObject(input) || typeof input.revision !== 'string' || input.revision !== currentRevision) {
        throw new Error('Конфигурация изменена в другом окне. Нажмите «Обновить», проверьте изменения и сохраните снова.');
    }
    const { devices, bindings } = input;
    if (!Array.isArray(devices) || !Array.isArray(bindings) || devices.length > 1000 || bindings.length > 5000) {
        throw new Error('Некорректные списки устройств или функций.');
    }
    // Defense in depth against oversized or malformed UI messages.
    if (JSON.stringify({ devices, bindings }).length > 4 * 1024 * 1024) {
        throw new Error('Размер конфигурации превышает 4 МБ.');
    }
    const ids = new Set();
    for (const d of devices) {
        if (!validPlainObject(d) || typeof d.id !== 'string' || !d.id.trim() || d.id.length > 512 || ids.has(d.id)) {
            throw new Error('ID устройств должны быть непустыми и уникальными.');
        }
        ids.add(d.id);
    }
    for (const b of bindings) {
        if (!validPlainObject(b) || !ids.has(b.deviceId)) {
            throw new Error('Найдена функция без существующего устройства.');
        }
        for (const key of ['parameters', 'mapping', 'readTransform', 'writeTransform']) {
            if (b[key] != null && b[key] !== '') {
                if (typeof b[key] !== 'string') throw new Error(`Некорректный ${key}.`);
                try { if (key === 'readTransform' || key === 'writeTransform') validateTransform(b[key]); else JSON.parse(b[key]); }
                catch (err) { throw new Error(`Неверное преобразование (${key}) для ${b.deviceId}: ${err.message}`); }
            }
        }
    }
    // Ensure incoming JSON cannot smuggle instance secrets or native overrides.
    return {
        devices: devices.map(device => {
            const { allowedUsers, ...rest } = device;
            return JSON.parse(JSON.stringify(rest));
        }),
        bindings: JSON.parse(JSON.stringify(bindings))
    };
}
module.exports = { editable, revision, validatedChange };
