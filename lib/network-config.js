'use strict';
// Preserve existing HTTP listener settings when upgrading from v0.3.17.
// Default native.port / native.bind may be materialized by Admin during an adapter upgrade.
const DEFAULT_BIND = '127.0.0.1';
const DEFAULT_PORT = 8096;
function validPort(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 65535;
}
function effectiveNetworkConfig(native = {}) {
    const oldPort = validPort(native.listenPort) ? Number(native.listenPort) : undefined;
    const newPort = validPort(native.port) ? Number(native.port) : undefined;
    const oldHost = typeof native.listenHost === 'string' && native.listenHost.trim() ? native.listenHost.trim() : undefined;
    const newBind = typeof native.bind === 'string' && native.bind.trim() ? native.bind.trim() : undefined;
    // On the initial upgrade, an injected default (8096) must not hide a custom old port.
    const port = oldPort && oldPort !== DEFAULT_PORT && (newPort === undefined || newPort === DEFAULT_PORT)
        ? oldPort : newPort ?? oldPort ?? DEFAULT_PORT;
    const bind = oldHost && oldHost !== DEFAULT_BIND && (!newBind || newBind === DEFAULT_BIND)
        ? oldHost : newBind ?? oldHost ?? DEFAULT_BIND;
    return {bind, port};
}
function needsMigration(native = {}) {
    return typeof native.listenHost === 'string' && native.listenHost.trim() !== '' ||
        validPort(native.listenPort);
}
function migrationPatch(native = {}) {
    const result = effectiveNetworkConfig(native);
    return { ...result, listenHost: '', listenPort: 0 };
}
function migrateBackupNative(native = {}) {
    const copy = {...native};
    Object.assign(copy, migrationPatch(native));
    delete copy.listenHost;
    delete copy.listenPort;
    return copy;
}
module.exports = {DEFAULT_BIND,DEFAULT_PORT,validPort,effectiveNetworkConfig,needsMigration,migrationPatch,migrateBackupNative};
