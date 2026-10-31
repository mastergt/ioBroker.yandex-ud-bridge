'use strict';
/* Standalone Materialize Admin tab. The device editor is shared with index_m.html,
   but tab saves only devices/bindings via ioBroker messages, never OAuth credentials. */
(() => {
    let rev = '';
    let dirty = false;
    let ready = false;
    let pending = false;
    const get = id => document.getElementById(id);
    function status(label, cls = '') {
        const el = get('tab-save-state');
        if (el) { el.textContent = label; el.className = cls; }
    }
    function instanceNumber() {
        const qs = new URLSearchParams(window.location.search).get('instance');
        const num = qs != null ? Number(qs) : Number(window.instance);
        return Number.isSafeInteger(num) && num >= 0 ? num : 0;
    }
    function send(command, data, done, fail) {
        const instance = `yandex-ud-bridge.${instanceNumber()}`;
        let completed = false;
        const waitMs = command === 'oauthDiagnostic' ? 46000 : 20000;
        const timeout = window.setTimeout(() => finish(new Error(`Нет ответа от ${instance} (${command}) за ${Math.round(waitMs/1000)} секунд.`)), waitMs);
        function finish(error, response) {
            if (completed) return;
            completed = true;
            clearTimeout(timeout);
            if (error || response?.error) fail(error?.message || response.error);
            else done(response);
        }
        try {
            if (window.socket && typeof window.socket.emit === 'function') {
                window.socket.emit('sendTo', instance, command, data, reply => finish(null, reply));
            } else if (typeof window.sendTo === 'function') {
                window.sendTo(instanceNumber(), command, data, reply => finish(null, reply));
            } else {
                finish(new Error('Связь с ioBroker Admin ещё не установлена. Проверь WebSocket и обнови страницу.'));
            }
        } catch (err) { finish(err); }
    }
    window.instance = instanceNumber();
    window.bridgeTabSend = send;
    function change(changed) {
        if (changed === false) { dirty = false; get('tab-save').disabled = !ready; return; }
        dirty = true;
        get('tab-save').disabled = !ready;
        status('Есть несохранённые изменения', 'unsaved');
    }
    function loadConfig() {
        pending = true; ready = false;
        get('tab-save').disabled = true;
        status('Загрузка конфигурации…');
        send('getTabConfig', {}, response => {
            pending = false;
            if (!Array.isArray(response?.devices) || !Array.isArray(response?.bindings) || !response?.revision) {
                status('Некорректный ответ адаптера', 'failed');
                return;
            }
            rev = response.revision;
            ready = true;
            window.load({devices:response.devices,bindings:response.bindings,oauthUserId:response.oauthUserId}, change);
            get('tab-save').disabled = false;
            status('Конфигурация загружена');
        }, error => { pending=false; status(error,'failed'); });
    }
    function saveConfig() {
        if (!ready || pending) return;
        // In the tab, window.save validates current form but never talks to Admin Save.
        window.save(data => {
            pending = true;
            get('tab-save').disabled = true;
            status('Сохранение…');
            send('saveTabConfig', {devices:data.devices,bindings:data.bindings,revision:rev}, response => {
                pending = false;
                rev = response.revision;
                dirty = false;
                get('tab-save').disabled = false;
                status('Сохранено. Адаптер применяет изменения.', 'saved');
            }, error => {
                pending=false;get('tab-save').disabled=false;
                status(error,'failed');
            });
        });
    }
    document.addEventListener('DOMContentLoaded', () => {
        get('tab-save').addEventListener('click', saveConfig);
        get('tab-reload').addEventListener('click', () => {
            if (dirty && !window.confirm('Несохранённые изменения будут потеряны. Обновить?')) return;
            if (!pending) loadConfig();
        });
        // Admin initializes its socket asynchronously. We only begin after it is available.
        let attempts = 0;
        function start() {
            if ((window.socket && typeof window.socket.emit === 'function') || typeof window.sendTo === 'function') {
                loadConfig();
            } else if (++attempts < 40) {
                window.setTimeout(start, 250);
            } else {
                status('Нет соединения с ioBroker Admin. Обновите страницу.', 'failed');
            }
        }
        start();
        window.addEventListener('beforeunload', event => {
            if (!dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
