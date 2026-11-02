'use strict';
const { validatedChange, revision } = require('./tab-config');
const {validPort, effectiveNetworkConfig, migrateBackupNative} = require('./network-config');

const FORMAT = 'iobroker.yandex-ud-bridge.full-backup';
const VERSION = 1;
const MAX_BYTES = 8 * 1024 * 1024;
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }

function exportSnapshot(config, tokens, instance, version, clock = () => new Date()) {
    const native = clone(config);
    if (!Array.isArray(native.devices) || !Array.isArray(native.bindings)) {
        throw new Error('Некорректные устройства и функции в текущей конфигурации.');
    }
    if (!object(tokens) || !object(tokens.access) || !object(tokens.refresh)) {
        throw new Error('Хранилище OAuth-токенов недоступно.');
    }
    return {
        format: FORMAT,
        schemaVersion: VERSION,
        createdAt: clock().toISOString(),
        adapterVersion: version,
        sourceInstance: instance,
        native,
        oauthTokens: clone(tokens)
    };
}

function validateSnapshot(data) {
    if (!object(data) || data.format !== FORMAT || data.schemaVersion !== VERSION) {
        throw new Error('Это не полный резервный архив Yandex UD Bridge (версия формата 1).');
    }
    const raw = JSON.stringify(data);
    if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('Файл резервной копии превышает 8 МБ.');
    const native = data.native;
    if (!object(native) || !Array.isArray(native.devices) || !Array.isArray(native.bindings)) {
        throw new Error('Нет конфигурации устройств и привязок.');
    }
    const required = ['oauthClientId','oauthClientSecret','oauthLogin','oauthPassword'];
    if (required.some(k => typeof native[k] !== 'string')) throw new Error('В резервной копии отсутствует полный комплект OAuth-реквизитов.');
    if (!validPort(effectiveNetworkConfig(native).port) ||
        (native.port != null && !validPort(native.port)) ||
        (native.listenPort != null && Number(native.listenPort) !== 0 && !validPort(native.listenPort))) {
        throw new Error('Неверный порт в резервной копии.');
    }
    const edited = validatedChange({devices:native.devices, bindings:native.bindings, revision:revision(native)}, revision(native));
    const tokens = data.oauthTokens;
    if (!object(tokens) || !object(tokens.access) || !object(tokens.refresh)) throw new Error('OAuth-токены отсутствуют.');
    for (const kind of ['access','refresh']) {
        if (Object.keys(tokens[kind]).length > 10000) throw new Error('Слишком много OAuth-токенов.');
        for (const [hash, record] of Object.entries(tokens[kind])) {
            if (!/^[0-9a-f]{64}$/.test(hash) || !object(record) || !nonempty(record.user) ||
                !Number.isFinite(record.expires) || record.expires < 0 ||
                (kind === 'refresh' && !nonempty(record.client))) {
                throw new Error('Неверное содержимое OAuth-токенов.');
            }
        }
    }
    // Clone before handing data to the adapter. Disallow pollution through JSON special keys.
    for (const key of Object.keys(native)) {
        if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Недопустимое поле в резервной копии.');
    }
    return { native:{...migrateBackupNative(clone(native)), ...edited}, oauthTokens:clone(tokens) };
}
module.exports = { FORMAT, VERSION, MAX_BYTES, exportSnapshot, validateSnapshot };
