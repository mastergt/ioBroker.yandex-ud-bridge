'use strict';
const https = require('node:https');
const crypto = require('node:crypto');
const { editable, revision, validatedChange } = require('./lib/tab-config');
const utils = require('@iobroker/adapter-core');
const { Adapter } = utils;
const { Bridge } = require('./lib/bridge');
const { LocalOAuth } = require('./lib/oauth');
const { runOAuthDiagnostic } = require('./lib/diagnostics');
const { createProviderServer } = require('./lib/server');
const { parseLegacy, convertLegacy } = require('./lib/legacy');
const { simplifyEnums } = require('./lib/categories');
const { exportSnapshot, validateSnapshot } = require('./lib/config-backup');
const {effectiveNetworkConfig,needsMigration,migrationPatch} = require('./lib/network-config');
class YandexUdBridge extends Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'yandex-ud-bridge' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.server = null; this.bridge = null; this.oauth = null;
        this.pending = new Map(); this.callbackTimer = null; this.diagnosticRunning = false; this.restoring = false;
    }
    async onReady() {
        try {
            this.bridge = new Bridge(this.config, {
                getState: async id => (await this.getForeignStateAsync(id))?.val,
                setState: (id, val) => this.setForeignStateAsync(id, { val, ack:false })
            }, this.log);
            const stateIds=new Set([...this.bridge.localIndex.keys(), ...this.bridge.onlineIndex.keys()]);
            for (const id of stateIds) await this.subscribeForeignStatesAsync(id);
            this.log.info(`Configured ${this.bridge.devices.size} devices, ${this.bridge.bindings.size} active bindings`);
            if (this.config.debugActions === true) this.log.info('[YUD TRACE] Action tracing enabled (info level). Disable after troubleshooting.');
            this.oauth = new LocalOAuth(this.config, utils.getAbsoluteInstanceDataDir(this), this.log);
            this.server = createProviderServer(this.bridge, this.config, this.log, this.oauth, url => {
                this.setState('info.lastRequest', { val:`${new Date().toISOString()} ${url}`, ack:true });
            });
            this.server.on('error', err => { this.log.error(`HTTP: ${err.message}`); this.setState('info.connection', {val:false,ack:true}); });
            const network = effectiveNetworkConfig(this.config);
            this.server.listen(network.port, network.bind, () => {
                this.log.info(`Yandex provider: http://${network.bind}:${network.port}/provider/v1.0/`);
                this.setState('info.connection', {val:true,ack:true});
            });
            if (!this.oauth.enabled()) this.log.warn('OAuth не настроен; авторизация недоступна до задания client ID, secret и логина.');
            // Do not block startup if the controller cannot save the legacy field migration.
            await this.migrateNetworkSettings();
            if (!['127.0.0.1','::1','localhost'].includes(network.bind)) this.log.warn('HTTP доступен из сети. Рекомендуется localhost + защищённый HTTPS reverse proxy.');
        } catch (err) { this.log.error(`Startup: ${err.stack || err.message}`); this.setState('info.lastError', {val:String(err.message),ack:true}); }
    }
    async migrateNetworkSettings() {
        try {
            const instanceId = `system.adapter.${this.namespace}`;
            const saved = await this.getForeignObjectAsync(instanceId);
            if (!saved?.native || !needsMigration(saved.native)) return;
            const patch = migrationPatch(saved.native);
            // Extending only these four keys leaves devices, bindings and encrypted OAuth
            // fields unchanged, unlike replacing the complete native configuration.
            await this.extendForeignObjectAsync(instanceId, {native:patch});
            this.log.info(`Migrated legacy HTTP listener settings to bind=${patch.bind}, port=${patch.port}.`);
        } catch (e) {
            this.log.warn(`Cannot persist legacy HTTP listener migration: ${e.message}. Existing listener remains active.`);
        }
    }
    async onStateChange(id, state) {
        if (!state || !this.bridge || !(this.bridge.localIndex.has(id)||this.bridge.onlineIndex.has(id))) return;
        try { this.queueCallback(await this.bridge.onStateChange(id,state.val)); } catch (e) { this.log.warn(e.message); }
    }
    queueCallback(changed) {
        if (!this.config.callbackEnabled || !this.config.callbackSkillId || !this.config.callbackOauthToken) return;
        for (const item of changed) {
            const d = this.bridge.devices.get(item.id);
            if (!d || !this.bridge.isVisible(d, this.config.oauthUserId || '1')) continue;
            const existing = this.pending.get(item.id) || { id:item.id, capabilities:[], properties:[] };
            if (item.status) existing.status=item.status;
            for (const kind of ['capabilities','properties']) for (const el of item[kind] || []) {
                const i = existing[kind].findIndex(e => e.type === el.type && e.state.instance === el.state.instance);
                if (i < 0) existing[kind].push(el); else existing[kind][i] = el;
            }
            this.pending.set(item.id,existing);
        }
        if (this.pending.size && !this.callbackTimer) this.callbackTimer = setTimeout(() => { this.callbackTimer = null; this.flushCallback().catch(e => this.log.warn(e.message)); }, 750);
    }
    async flushCallback() {
        const devices = [...this.pending.values()].map(item=>{
            // For a status-only notification omit empty capability/property arrays.
            if (!item.capabilities.length) delete item.capabilities;
            if (!item.properties.length) delete item.properties;
            return item;
        }); this.pending.clear(); if (!devices.length) return;
        const payload = JSON.stringify({ ts: Math.floor(Date.now()/1000), payload:{ user_id:String(this.config.oauthUserId || '1'), devices } });
        const request = https.request({ hostname:'dialogs.yandex.net',method:'POST',port:443,path:`/api/v1/skills/${encodeURIComponent(this.config.callbackSkillId)}/callback/state`,timeout:8000,headers:{ Authorization:`OAuth ${this.config.callbackOauthToken}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} }, r => { r.resume(); if (r.statusCode >= 300) this.log.warn(`Callback HTTP ${r.statusCode}`); });
        request.on('timeout',()=>request.destroy(new Error('Callback timeout')));
        request.on('error',e=>this.log.warn(`Callback ${e.message}`)); request.end(payload);
    }
    async onMessage(msg) {
        if (!msg?.callback) return;
        try {
            // These commands provide adapter configuration, local object metadata and diagnostics.
            // They are part of the Admin UI; other adapters must not be able to change
            // device bindings through sendTo or enumerate the user's ioBroker state tree.
            const adminOnlyCommands = new Set([
                'getTabConfig', 'saveTabConfig', 'oauthDiagnostic',
                'importFile', 'preview', 'categories', 'candidates'
            ]);
            if (adminOnlyCommands.has(msg.command) &&
                !/^(?:system\.adapter\.)?admin\.\d+$/.test(msg.from || '')) {
                throw new Error('Команды настройки доступны только из ioBroker Admin.');
            }
            if (msg.command === 'getTabConfig') {
                // Never expose native credentials to the standalone sidebar UI.
                const obj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
                if (!obj?.native) throw new Error('Не удалось прочитать настройки экземпляра.');
                this.sendTo(msg.from, msg.command, {
                    ...editable(obj.native),
                    oauthUserId: String(obj.native.oauthUserId || '1'),
                    revision: revision(obj.native),
                    serverHost: effectiveNetworkConfig(this.config).bind,
                    serverPort: effectiveNetworkConfig(this.config).port,
                    oauthConfigured: !!(this.config.oauthClientId && this.config.oauthClientSecret && this.config.oauthLogin && this.config.oauthPassword)
                }, msg.callback);
            } else if (msg.command === 'saveTabConfig') {
                const id = `system.adapter.${this.namespace}`;
                const current = await this.getForeignObjectAsync(id);
                if (!current?.native) throw new Error('Не удалось прочитать настройки экземпляра.');
                const changed = validatedChange(msg.message, revision(current.native));
                // Update only arrays: do not replace OAuth, HTTP, or encrypted native options.
                await this.extendForeignObjectAsync(id, { native: changed });
                this.sendTo(msg.from, msg.command, { ok: true, revision: revision(changed) }, msg.callback);
            } else if (msg.command === 'jsonOAuthBootstrap' || msg.command === 'jsonOAuthRotatePassword') {
                // JSON Config's sendTo/useNative button is only for the trusted ioBroker Admin UI.
                if (!/^(?:system\.adapter\.)?admin\.\d+$/.test(msg.from || '')) throw new Error('OAuth setup is only available from ioBroker Admin.');
                if (msg.command === 'jsonOAuthBootstrap' &&
                    ['oauthClientId','oauthClientSecret','oauthLogin','oauthPassword'].some(k => this.config[k])) {
                    throw new Error('OAuth credentials are already configured or partially filled. Existing credentials were not changed.');
                }
                const rand = bytes => crypto.randomBytes(bytes).toString('hex');
                const credentials = msg.command === 'jsonOAuthBootstrap'
                    ? {oauthClientId:rand(16),oauthClientSecret:rand(32),oauthLogin:'home',oauthPassword:rand(20)}
                    : {oauthLogin:String(this.config.oauthLogin||'home').trim() || 'home',oauthPassword:rand(20)};
                // Return values for Admin's UNSAVED edit buffer. The server does not persist or activate
                // the new credentials until the user explicitly saves the normal JSON Config dialog.
                // The Admin form replaces its full native edit buffer when `useNative` is set.
                // Read the latest instance object, because the device editor may have saved
                // new bindings since the adapter was started. Avoid returning encrypted raw
                // values: protected fields are taken from the already-decrypted runtime config.
                const current = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
                const native = {...this.config,...(current?.native || {}),...credentials};
                for (const field of ['oauthClientSecret','oauthPassword','callbackOauthToken']) {
                    if (!Object.hasOwn(credentials, field)) native[field] = this.config[field] || '';
                }
                this.sendTo(msg.from,msg.command,{native},msg.callback);
            } else if (msg.command === 'fullBackupExport') {
                if (!/^(?:system\.adapter\.)?admin\.\d+$/.test(msg.from || '')) throw new Error('Экспорт доступен только из ioBroker Admin.');
                if (!this.oauth) throw new Error('Хранилище OAuth ещё не готово.');
                const snapshot = exportSnapshot(this.config, this.oauth.tokens, this.namespace, require('./package.json').version);
                this.sendTo(msg.from, msg.command, snapshot, msg.callback);
            } else if (msg.command === 'fullBackupRestore') {
                if (!/^(?:system\.adapter\.)?admin\.\d+$/.test(msg.from || '')) throw new Error('Восстановление доступно только из ioBroker Admin.');
                if (this.restoring) throw new Error('Восстановление уже выполняется.');
                if (typeof this.updateConfig !== 'function') throw new Error('Текущая версия js-controller не поддерживает безопасное восстановление шифрованных настроек через updateConfig(). Обновите js-controller.');
                if (!this.oauth) throw new Error('Хранилище OAuth ещё не готово.');
                const restored = validateSnapshot(msg.message?.backup);
                // Validate before any changes. Config update may cause an instance restart.
                this.restoring = true;
                const previousTokens = this.oauth.tokens;
                try {
                    this.oauth.tokens = restored.oauthTokens;
                    this.oauth.persist();
                    // Encrypts protected native fields with the destination controller's secret.
                    await this.updateConfig(restored.native);
                    this.sendTo(msg.from, msg.command, {ok:true, message:'Конфигурация и OAuth-токены восстановлены. Дождитесь перезапуска адаптера.'}, msg.callback);
                } catch (err) {
                    this.oauth.tokens = previousTokens;
                    this.oauth.persist();
                    throw err;
                } finally {
                    this.restoring = false;
                }
            } else if (msg.command === 'oauthDiagnostic') {
                if (this.diagnosticRunning) throw new Error('Диагностика уже выполняется.');
                this.diagnosticRunning = true;
                try {
                    const result = await runOAuthDiagnostic({ server:this.server, oauth:this.oauth, bridge:this.bridge, config:this.config });
                    this.sendTo(msg.from, msg.command, result, msg.callback);
                } finally {
                    this.diagnosticRunning = false;
                }
            } else if (msg.command === 'importFile') {
                const input = parseLegacy(msg.message?.source);
                const result = convertLegacy(input);
                this.sendTo(msg.from,msg.command,result,msg.callback);
            } else if (msg.command === 'preview') {
                const data = msg.message || {};
                const bridge = new Bridge(data.config || this.config, { getState: id => this.getForeignStateAsync(id).then(s=>s?.val), setState:()=>{} }, this.log);
                this.sendTo(msg.from,msg.command,{devices:bridge.discover(String(data.userId || this.config.oauthUserId || '1'))},msg.callback);
            } else if (msg.command === 'categories') {
                // Read live category memberships; do not change any ioBroker enum objects.
                const [rooms, functions] = await Promise.all([
                    this.getForeignObjectsAsync('enum.rooms.*', 'enum'),
                    this.getForeignObjectsAsync('enum.functions.*', 'enum')
                ]);
                this.sendTo(msg.from, msg.command, {
                    rooms: simplifyEnums(rooms, 'enum.rooms'),
                    functions: simplifyEnums(functions, 'enum.functions')
                }, msg.callback);
            } else if (msg.command === 'candidates') {
                const groups = await Promise.all(['state','device','channel'].map(async type=>{
                    try {return {type,objects:await this.getForeignObjectsAsync('*',type)};}
                    catch(err){
                        this.log.warn(`Cannot load object tree ${type}: ${err.message}`);
                        // State objects are mandatory. Report errors to Admin instead of an empty tree.
                        if(type === 'state') throw new Error(`Ошибка чтения ioBroker States: ${err.message}`);
                        return {type,objects:{}};
                    }
                }));
                const items=[];
                for (const group of groups) {
                    for (const [id,o] of Object.entries(group.objects||{})) {
                        if (items.length >= 30000) break;
                        const raw=o.common?.name;
                        const name=typeof raw==='string'?raw:raw?.ru||raw?.en||id;
                        items.push({id,objectType:group.type,name,role:o.common?.role||'',type:o.common?.type||'',write:!!o.common?.write,read:o.common?.read!==false,unit:o.common?.unit||''});
                    }
                }
                this.sendTo(msg.from,msg.command,items,msg.callback);
            }
        } catch (err) { this.sendTo(msg.from,msg.command,{error:err.message},msg.callback); }
    }
    onUnload(callback) {
        (async () => {
            if (this.callbackTimer) clearTimeout(this.callbackTimer);
            if (this.server?.listening) await new Promise(resolve=>this.server.close(resolve));
            await this.setStateAsync('info.connection',{val:false,ack:true}); callback();
        })().catch(e=>{this.log.error(e.message);callback();});
    }
}
if (require.main === module) new YandexUdBridge();
else module.exports = options => new YandexUdBridge(options);
