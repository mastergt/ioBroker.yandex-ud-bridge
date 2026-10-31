/* Security-sensitive OAuth bootstrap. WebCrypto is required; no Math.random fallback. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.BridgeOAuthSetup = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    function randomHex(cryptoApi, length) {
        if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') throw new Error('Для генерации ключей необходим браузер с WebCrypto (HTTPS).');
        const buf = new Uint8Array(length);
        cryptoApi.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    }
    function generate(cryptoApi) {
        return {
            oauthClientId: randomHex(cryptoApi, 16),
            oauthClientSecret: randomHex(cryptoApi, 32),
            oauthLogin: 'home',
            oauthPassword: randomHex(cryptoApi, 20)
        };
    }
    // Rotate only the credentials used on the local login form. The Yandex OAuth
    // client pair remains intact, so the published skill does not need updating.
    function generateAccount(cryptoApi, currentLogin = '') {
        return {
            oauthLogin: String(currentLogin || '').trim() || 'home',
            oauthPassword: randomHex(cryptoApi, 20)
        };
    }
    function externalBase(input) {
        if (!String(input || '').trim()) return '';
        let url;
        try { url = new URL(String(input).trim()); } catch { throw new Error('Неверный публичный адрес. Укажи https://домен'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) {
            throw new Error('Нужен публичный HTTPS-адрес без логина, пути и параметров, например https://smart.example.ru');
        }
        return url.origin;
    }
    function addresses(input) {
        const base = externalBase(input);
        if (!base) return null;
        return {
            provider: base+'/provider/',
            authorize: base+'/oauth/authorize',
            token: base+'/oauth/token',
            refresh: base+'/oauth/token'
        };
    }
    function allEmpty(cfg) {
        return ['oauthClientId', 'oauthClientSecret', 'oauthLogin', 'oauthPassword'].every(k=>!cfg[k]);
    }
    return { generate, generateAccount, externalBase, addresses, allEmpty };
});
