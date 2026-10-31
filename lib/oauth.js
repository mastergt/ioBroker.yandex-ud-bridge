'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const secret = () => crypto.randomBytes(32).toString('base64url');
const fixedEqual = (a, b) => {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class LocalOAuth {
    constructor(config, dataDir, log = console, clock = () => Date.now()) {
        this.config = config; this.log = log; this.clock = clock;
        this.file = path.join(dataDir, 'oauth-tokens.json');
        this.pendingFile = path.join(dataDir, 'oauth-pending.json');
        this.tokens = { access: {}, refresh: {} };
        this.codes = new Map(); this.requests = new Map(); this.failures = new Map();
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        if (fs.existsSync(this.file)) {
            try { const data = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.tokens = { access: data.access || {}, refresh: data.refresh || {} }; }
            catch (err) { throw new Error(`OAuth token store unreadable: ${err.message}`); }
        }
        if (fs.existsSync(this.pendingFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8'));
                for (const [hash, record] of Object.entries(data)) {
                    if (/^[0-9a-f]{64}$/.test(hash) && record &&
                        record.expires > this.clock() &&
                        record.client_id === this.config.oauthClientId &&
                        record.redirect_uri === 'https://social.yandex.net/broker/redirect') {
                        this.requests.set(hash, record);
                    }
                }
            } catch (err) { throw new Error(`OAuth pending store unreadable: ${err.message}`); }
        }
    }
    persistPending() {
        const temp = `${this.pendingFile}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(this.requests)), { mode: 0o600 });
        fs.renameSync(temp, this.pendingFile);
    }
    enabled() { return !!(this.config.oauthClientId && this.config.oauthClientSecret && this.config.oauthLogin && this.config.oauthPassword); }
    userId() { return String(this.config.oauthUserId || '1'); }
    authRequest(params) {
        if (!this.enabled()) throw new Error('OAuth not configured');
        if (params.client_id !== this.config.oauthClientId || params.response_type !== 'code') throw new Error('Invalid OAuth client or response_type');
        if (params.redirect_uri !== 'https://social.yandex.net/broker/redirect') throw new Error('Unapproved OAuth redirect_uri');
        if (String(params.state || '').length > 1024 || String(params.scope || '').length > 1024) throw new Error('Invalid state or scope');
        for (const [key, pending] of this.requests) if (pending.expires < this.clock()) this.requests.delete(key);
        if (this.requests.size > 1000) throw new Error('Too many pending OAuth requests');
        const nonce = secret();
        this.requests.set(sha(nonce), { ...params, expires: this.clock() + 15 * 60_000 });
        this.persistPending();
        return nonce;
    }
    login({ nonce, username, password, ip = '' }) {
        const now = this.clock(); const bucket = this.failures.get(ip) || { count: 0, until: now + 15 * 60_000 };
        if (bucket.until < now) { bucket.count = 0; bucket.until = now + 15 * 60_000; }
        if (bucket.count >= 6) return { error: 'Too many login attempts', status: 429 };
        const record = this.requests.get(sha(String(nonce || '')));
        if (!record || record.expires < now) {
            if (record) { this.requests.delete(sha(nonce)); this.persistPending(); }
            this.log.warn?.(`OAuth pending request missing or expired (nonceProvided=${!!nonce}, pending=${this.requests.size})`);
            return { error: 'Authorization request expired', status: 400 };
        }
        if (!fixedEqual(username || '', this.config.oauthLogin) || !fixedEqual(password || '', this.config.oauthPassword)) {
            bucket.count++; this.failures.set(ip, bucket); return { error: 'Неверный логин или пароль', status: 401 };
        }
        this.failures.delete(ip); this.requests.delete(sha(nonce));
        this.persistPending();
        const code = secret();
        this.codes.set(sha(code), { client: record.client_id, redirect: record.redirect_uri, user: this.userId(), expires: now + 5 * 60_000 });
        const location = new URL(record.redirect_uri);
        location.searchParams.set('code', code);
        if (record.state !== undefined) location.searchParams.set('state', record.state);
        if (record.client_id !== undefined) location.searchParams.set('client_id', record.client_id);
        if (record.scope !== undefined) location.searchParams.set('scope', record.scope);
        return { location: location.toString() };
    }
    clientOk(id, pass) { return this.enabled() && fixedEqual(id || '', this.config.oauthClientId) && fixedEqual(pass || '', this.config.oauthClientSecret); }
    persist() {
        const temp = `${this.file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify(this.tokens), { mode: 0o600 });
        fs.renameSync(temp, this.file);
    }
    tokenRequest(body, client) {
        const now = this.clock();
        if (!this.clientOk(client.id, client.secret)) return { status: 401, body: { error: 'invalid_client' } };
        const expiresIn = 24 * 60 * 60;
        let user;
        if (body.grant_type === 'authorization_code') {
            const hash = sha(String(body.code || ''));
            const grant = this.codes.get(hash); this.codes.delete(hash);
            if (!grant || grant.expires < now || grant.client !== client.id || grant.redirect !== body.redirect_uri) return { status: 400, body: { error: 'invalid_grant' } };
            user = grant.user;
        } else if (body.grant_type === 'refresh_token') {
            const hash = sha(String(body.refresh_token || ''));
            const grant = this.tokens.refresh[hash];
            if (!grant || grant.expires < now || grant.client !== client.id) return { status: 400, body: { error: 'invalid_grant' } };
            user = grant.user; delete this.tokens.refresh[hash];
        } else return { status: 400, body: { error: 'unsupported_grant_type' } };
        const accessToken = secret(), refreshToken = secret();
        this.tokens.access[sha(accessToken)] = { user, expires: now + expiresIn * 1000 };
        this.tokens.refresh[sha(refreshToken)] = { user, client: client.id, expires: now + 90 * 24 * 60 * 60_000 };
        for (const kind of ['access', 'refresh']) for (const [key, row] of Object.entries(this.tokens[kind])) if (row.expires <= now) delete this.tokens[kind][key];
        this.persist();
        return { status: 200, body: { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refreshToken } };
    }
    revokeDiagnosticTokens(accessTokens = [], refreshTokens = []) {
        let changed = false;
        for (const [kind, list] of [['access', accessTokens], ['refresh', refreshTokens]]) {
            for (const token of list) {
                const hashed = sha(String(token));
                if (Object.hasOwn(this.tokens[kind], hashed)) {
                    delete this.tokens[kind][hashed];
                    changed = true;
                }
            }
        }
        if (changed) this.persist();
    }
    validate(token) { const record = this.tokens.access[sha(String(token || ''))]; return record && record.expires > this.clock() ? record.user : null; }
    unlink(user) {
        for (const kind of ['access','refresh']) for (const [key, value] of Object.entries(this.tokens[kind])) if (value.user === String(user)) delete this.tokens[kind][key];
        this.persist();
    }
}
module.exports = { LocalOAuth };
