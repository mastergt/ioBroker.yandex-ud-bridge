'use strict';

/* End-to-end local OAuth diagnostic. It exercises the HTTP API rather than
   calling OAuth methods directly. No commands are sent to actual devices. */
const REDIRECT = 'https://social.yandex.net/broker/redirect';
const REQUEST_TIMEOUT_MS = 4000;

function localBase(server) {
    if (!server || !server.listening || !server.address()) { const e = new Error('HTTP offline'); e.safeMessage = 'HTTP-сервер адаптера не запущен.'; throw e; }
    const address = server.address();
    if (typeof address === 'string') { const e = new Error('HTTP socket type'); e.safeMessage = 'HTTP-сервер использует Unix socket вместо TCP.'; throw e; }
    let host = address.address;
    if (host === '0.0.0.0' || !host) host = '127.0.0.1';
    else if (host === '::') host = '::1';
    if (host.includes(':')) host = `[${host}]`;
    return `http://${host}:${address.port}`;
}

async function runOAuthDiagnostic({ server, oauth, bridge, config }) {
    const steps = [];
    const issuedAccess = [];
    const issuedRefresh = [];
    let deviceCount = 0;
    let queryResult = 'Не выполнялся';
    const started = Date.now();

    const check = async (id, title, task) => {
        const at = Date.now();
        try {
            const outcome = await task();
            const description = typeof outcome === 'string' ? outcome : outcome?.message || 'Успешно';
            steps.push({ id, title, status: outcome?.status === 'warning' ? 'warning' : 'ok', message: description, elapsedMs: Date.now() - at });
            return true;
        } catch (err) {
            // Never echo request bodies, Authorization headers, credentials or tokens.
            steps.push({ id, title, status: 'error', message: String(err?.safeMessage || 'Проверка завершилась с ошибкой.'), elapsedMs: Date.now() - at });
            return false;
        }
    };
    const failure = message => { const err = new Error('Диагностика'); err.safeMessage = message; throw err; };
    const request = async (base, route, opts = {}) => {
        let response;
        try {
            response = await fetch(base + route, { ...opts, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        } catch (err) {
            failure(err.name === 'TimeoutError' ? 'Превышено время ожидания ответа HTTP-сервера.' : 'Нет соединения с локальным HTTP-сервером.');
        }
        return response;
    };
    const parseJson = async response => {
        try { return await response.json(); }
        catch { failure('API вернул некорректный JSON.'); }
    };
    const expectStatus = (response, expected, label) => {
        if (response.status !== expected) failure(`${label}: HTTP ${response.status}, ожидается ${expected}.`);
    };
    let base;
    try {
        if (!await check('config', 'Настройки OAuth', () => {
            if (!oauth?.enabled()) failure('OAuth не настроен. Создай реквизиты и сохрани настройки экземпляра.');
            if (!config.oauthUserId) return 'Реквизиты заполнены; используется User ID по умолчанию.';
            return 'Client ID, Secret и локальная учётная запись настроены.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        if (!await check('http', 'HTTP-сервер провайдера', async () => {
            base = localBase(server);
            const response = await request(base, '/provider/v1.0/', { method:'HEAD' });
            expectStatus(response, 200, 'HEAD /provider/v1.0/');
            return 'Сервер доступен локально; HEAD /provider/v1.0/ → 200.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        if (!await check('unauthorized', 'Защита API', async () => {
            const response = await request(base, '/provider/v1.0/user/devices');
            expectStatus(response, 401, 'Запрос без токена');
            return 'Запрос без Bearer-токена отклонён: HTTP 401.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        let code = '';
        if (!await check('authorization', 'Выдача authorization code', async () => {
            const authorize = new URL('/oauth/authorize', base);
            authorize.searchParams.set('response_type', 'code');
            authorize.searchParams.set('client_id', config.oauthClientId);
            authorize.searchParams.set('redirect_uri', REDIRECT);
            authorize.searchParams.set('state', 'diagnostics');
            const page = await request(base, authorize.pathname + authorize.search);
            expectStatus(page, 200, 'Форма авторизации');
            const html = await page.text();
            const nonce = /name="nonce"\s+value="([^"]+)"/.exec(html)?.[1];
            if (!nonce) failure('В форме авторизации отсутствует nonce.');
            const form = new URLSearchParams({ nonce, username:config.oauthLogin, password:config.oauthPassword });
            const login = await request(base, '/oauth/authorize', {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
            expectStatus(login, 302, 'Подтверждение учётной записи');
            let redirect;
            try { redirect = new URL(login.headers.get('location')); }
            catch { failure('После авторизации не получен корректный redirect.'); }
            if (redirect.origin + redirect.pathname !== REDIRECT) failure('OAuth redirect не совпадает с адресом Яндекса.');
            if (redirect.searchParams.get('state') !== 'diagnostics') failure('Сервер потерял параметр OAuth state.');
            code = redirect.searchParams.get('code');
            if (!code) failure('Не получен authorization code.');
            return 'Форма авторизации, логин, пароль, redirect_uri и state проверены.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        const basic = `Basic ${Buffer.from(`${config.oauthClientId}:${config.oauthClientSecret}`).toString('base64')}`;
        const formHeaders = {'Content-Type':'application/x-www-form-urlencoded', 'Authorization':basic};
        let access = '', refresh = '';
        if (!await check('token', 'Обмен кода на токены', async () => {
            const payload = new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:REDIRECT });
            const response = await request(base, '/oauth/token', {method:'POST', headers:formHeaders,body:payload});
            expectStatus(response, 200, 'POST /oauth/token');
            const body = await parseJson(response);
            if (!body.access_token || !body.refresh_token || body.token_type !== 'Bearer') failure('Ответ не содержит обязательные access/refresh-токены.');
            access = body.access_token; refresh = body.refresh_token;
            issuedAccess.push(access); issuedRefresh.push(refresh);
            return 'Access и refresh-токены получены (значения скрыты).';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        if (!await check('discovery', 'Список устройств', async () => {
            const response = await request(base, '/provider/v1.0/user/devices', {headers:{ Authorization:`Bearer ${access}` }});
            expectStatus(response, 200, 'GET /user/devices');
            const body = await parseJson(response);
            if (!Array.isArray(body?.payload?.devices)) failure('Ответ discovery не содержит массива устройств.');
            if (String(body.payload.user_id) !== String(oauth.userId())) failure('Неверный user_id в ответе discovery.');
            deviceCount = body.payload.devices.length;
            return deviceCount ? `Успешно. Опубликовано устройств: ${deviceCount}.` : {status:'warning',message:'API работает, но опубликованных устройств пока нет. Проверь привязки функций.'};
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        if (!await check('query', 'Чтение состояния', async () => {
            const devices = bridge.discover(oauth.userId());
            if (!devices.length) return {status:'warning', message:'Пропущено: нет опубликованных устройств. Команды не отправлялись.'};
            const response = await request(base, '/provider/v1.0/user/devices/query', {
                method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${access}`},
                body:JSON.stringify({devices:[{id:devices[0].id}]})
            });
            expectStatus(response, 200, 'POST /user/devices/query');
            const body = await parseJson(response);
            if (!Array.isArray(body?.payload?.devices)) failure('Ответ query не содержит массива устройств.');
            queryResult = String(body.payload.devices[0]?.error_code || 'OK');
            if (queryResult !== 'OK') return {status:'warning',message:`API ответил, но первое устройство имеет состояние ${queryResult}.`};
            return 'Состояние первого устройства прочитано без изменения его значения.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        let refreshedAccess = '';
        if (!await check('refresh', 'Обновление токена', async () => {
            const payload = new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh});
            const response = await request(base, '/oauth/token', {method:'POST',headers:formHeaders,body:payload});
            expectStatus(response, 200, 'POST /oauth/token (refresh)');
            const body = await parseJson(response);
            if (!body.access_token || !body.refresh_token || body.access_token === access || body.refresh_token === refresh) failure('Refresh не выдал новую пару токенов.');
            refreshedAccess = body.access_token;
            issuedAccess.push(body.access_token); issuedRefresh.push(body.refresh_token);
            const valid = await request(base, '/provider/v1.0/user/devices', {headers:{Authorization:`Bearer ${refreshedAccess}`}});
            expectStatus(valid, 200, 'Запрос с обновлённым токеном');
            return 'Refresh-токен заменён; новый access-токен работает.';
        })) return { ok:false, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };

        return { ok:true, steps, deviceCount, durationMs:Date.now()-started, testedAt:new Date().toISOString() };
    } finally {
        // Do not revoke all tokens for the OAuth user. Revoke ONLY those created
        // during this diagnostic. Real Yandex sessions must remain valid.
        if (issuedAccess.length || issuedRefresh.length) {
            try { oauth.revokeDiagnosticTokens(issuedAccess, issuedRefresh); }
            catch { steps.push({id:'cleanup',title:'Очистка тестовых токенов',status:'error',message:'Не удалось удалить тестовые токены. Проверь права на каталог данных.',elapsedMs:0}); }
        }
    }
}
module.exports = { runOAuthDiagnostic, localBase };
