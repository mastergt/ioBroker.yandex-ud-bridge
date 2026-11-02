'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { URLSearchParams } = require('node:url');
const { LocalOAuth } = require('./oauth');
const { traceAction } = require('./action-trace');

function send(res, status, obj, head = false, headers = {}) {
    const data = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers });
    res.end(head ? undefined : data);
}
function html(res, status, content) {
    res.writeHead(status, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://social.yandex.net https://social.yandex.ru; base-uri 'none'" });
    res.end(content);
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 64*1024) { const e = Error('Too large'); e.status = 413; throw e; } chunks.push(chunk); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (req.headers['content-type']?.includes('application/json')) { try { return JSON.parse(text); } catch { const e = Error('Bad JSON'); e.status=400; throw e; } }
    return Object.fromEntries(new URLSearchParams(text));
}
function authPage(nonce, error = '') {
    const expired = error === 'Authorization request expired';
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение Яндекс Умного дома</title><style>body{font:16px system-ui;background:#111827;color:#e8edf7;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#202c3f;border:1px solid #384861;border-radius:22px;padding:36px;max-width:400px;width:85vw}input{box-sizing:border-box;width:100%;padding:13px;margin:8px 0 17px;border:1px solid #6b7a91;background:#101a2b;color:white;border-radius:10px;font-size:16px}button{width:100%;border:0;border-radius:10px;padding:14px;background:#5f82ef;color:white;font-weight:700;font-size:16px}.sub{opacity:.75}.error{color:#ff9696}</style><div class="card"><h2>Умный дом · Авторизация</h2><p class="sub">Разрешите навыку Яндекса доступ к выбранным устройствам ioBroker.</p>${error ? `<p class="error">${esc(error)}</p>` : ''}${expired ? '<p class="sub">Запрос авторизации больше не действует. Закройте страницу и заново начните привязку в «Дом с Алисой».</p>' : `<form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="${esc(nonce)}"><label>Логин<input name="username" required autocomplete="username"></label><label>Пароль<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Подключить к Яндексу</button></form>`}</div></html>`;
}
function getClient(req, payload) {
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    if (basic) { try { const data = Buffer.from(basic[1], 'base64').toString('utf8'); const sep = data.indexOf(':'); if (sep >= 0) return { id: data.slice(0,sep), secret: data.slice(sep+1) }; } catch {} }
    return { id: payload.client_id, secret: payload.client_secret };
}
// Only a local Nginx proxy is permitted to supply the original client IP.
// Never trust X-Forwarded-For or X-Real-IP from arbitrary Internet clients.
function loginClientIp(req, trustProxy = false) {
    const remote = String(req.socket?.remoteAddress || '');
    if (!trustProxy || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return remote;
    const forwarded = req.headers['x-real-ip'];
    const ip = typeof forwarded === 'string' ? forwarded.trim() : '';
    return net.isIP(ip) ? ip : remote;
}
function createProviderServer(bridge, config, log, oauth, onRequest = () => {}) {
    if (!(oauth instanceof LocalOAuth)) throw Error('Local OAuth storage required');
    const server = http.createServer(async (req, res) => {
        const method = req.method;
        const route = (req.url || '').split('?')[0].replace(/^\/provider(?=\/|$)/, '').replace(/\/$/, '') || '/';
        const rid = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 200);
        try {
            if ((method === 'HEAD' || method === 'GET') && (route === '/v1.0' || route === '/')) { res.writeHead(200, {'Cache-Control':'no-store'}); res.end(); return; }
            if (method === 'GET' && route === '/oauth/authorize') {
                const params = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
                const nonce = oauth.authRequest(params); html(res, 200, authPage(nonce)); return;
            }
            if (method === 'POST' && route === '/oauth/authorize') {
                const data = await body(req); const result = oauth.login({ ...data, ip: loginClientIp(req, config.trustProxy === true) });
                if (result.error) { html(res, result.status || 401, authPage(data.nonce || '', result.error)); return; }
                res.writeHead(302, { Location: result.location, 'Cache-Control':'no-store' }); res.end(); return;
            }
            if (method === 'POST' && (route === '/oauth/token' || route === '/oauth/refresh')) {
                const data = await body(req); const answer = oauth.tokenRequest(data, getClient(req, data));
                send(res, answer.status, answer.body); return;
            }
            const bearer = /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization || ''));
            const userId = bearer ? oauth.validate(bearer[1]) : null;
            if (!userId) { send(res, 401, { request_id: rid, error: 'UNAUTHORIZED' }); return; }
            onRequest(`${rid} ${method} ${route}`);
            if (method === 'GET' && route === '/v1.0/user/devices') {
                send(res, 200, { request_id: rid, payload: { user_id: userId, devices: bridge.discover(userId) } }); return;
            }
            if (method === 'POST' && route === '/v1.0/user/devices/query') {
                const input = await body(req);
                if (!Array.isArray(input.devices)) { send(res, 400, { request_id:rid, error:'INVALID_REQUEST' }); return; }
                send(res, 200, { request_id:rid, payload:{ devices: await bridge.query(userId, input.devices) } }); return;
            }
            if (method === 'POST' && route === '/v1.0/user/devices/action') {
                const input = await body(req);
                if (!Array.isArray(input?.payload?.devices)) { send(res, 400, { request_id:rid, error:'INVALID_REQUEST' }); return; }
                traceAction(config, log, rid, '*', 'HTTP', `POST /user/devices/action devices=${input.payload.devices.length}`);
                send(res, 200, { request_id:rid, payload:{ devices: await bridge.action(userId, input.payload.devices, { requestId:rid }) } }); return;
            }
            if (method === 'POST' && route === '/v1.0/user/unlink') {
                oauth.unlink(userId); send(res, 200, { request_id:rid }); return;
            }
            send(res, 404, { request_id:rid, error:'NOT_FOUND' });
        } catch (err) {
            log.warn(`HTTP ${method} ${route}: ${err.message}`);
            send(res, err.status || 400, { request_id:rid, error: err.status ? 'INVALID_REQUEST' : 'INVALID_REQUEST' });
        }
    });
    server.headersTimeout = 10_000; server.requestTimeout = 15_000;
    return server;
}
module.exports = { createProviderServer, loginClientIp };
