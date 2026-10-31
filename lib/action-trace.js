'use strict';
// Only trace Yandex action metadata and values, never HTTP auth headers or OAuth credentials.
// All trace lines use info level so they are visible at the default ioBroker loglevel.
function clean(value, maxLength = 180) {
    return String(value ?? '').replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').slice(0, maxLength);
}
function safeTraceValue(value) {
    let result;
    try { result = JSON.stringify(value); } catch { result = '[unserializable]'; }
    if (result === undefined) return 'undefined';
    // The action protocol does not carry credentials; nevertheless redact unexpected tokens/URLs.
    if (/bearer\s|oauth\s|access_token|refresh_token|client_secret|password|https?:\/\//i.test(result)) return '[REDACTED]';
    return clean(result, 240);
}
function traceAction(config, log, requestId, deviceId, stage, detail) {
    if (config?.debugActions !== true) return;
    const request = clean(requestId || 'direct', 64).replace(/[^\w.-]/g, '_');
    const device = clean(deviceId, 120);
    log.info?.(`[YUD TRACE] req=${request} device=${device} ${clean(stage, 30)} ${clean(detail, 600)}`);
}
module.exports = { safeTraceValue, traceAction };
