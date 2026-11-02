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

    const FOOTER_SELECTORS = ['.adminButtons','.admin-buttons','.adapter-buttons','.m-footer','.ui-dialog-buttonpane','.saveButtons','.buttons','.footer','.page-footer','.admin-tab__footer'];
    const FOOTER_BUTTON_SELECTORS = ['button','a','.btn','input[type=button]','input[type=submit]'];
    const FOOTER_FLAG_ATTR = 'data-yud-hide-legacy-footer';
    let footerObserver = null;
    function footerText(el) {
        if (!el) return '';
        const raw = typeof el.value === 'string' && !el.innerText ? el.value : (el.innerText || el.textContent || '');
        return String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
    }
    function isSaveLabel(text) {
        return /(save|сохранить)/.test(text || '');
    }
    function isCloseLabel(text) {
        return /(close|cancel|отмена|выйти|закрыть)/.test(text || '');
    }
    function footerBarLooksLikeSaveCloseBar(el) {
        const text = footerText(el);
        return isSaveLabel(text) && isCloseLabel(text);
    }
    function eachRelevantDocument(callback) {
        const docs = [document];
        try { if (window.parent && window.parent !== window && window.parent.document) docs.push(window.parent.document); } catch (_e) {}
        try { if (window.top && window.top !== window && window.top.document) docs.push(window.top.document); } catch (_e) {}
        const seen = new Set();
        docs.forEach(doc => {
            if (doc && !seen.has(doc)) {
                seen.add(doc);
                callback(doc);
            }
        });
    }
    function setElementHidden(el, hidden) {
        if (!el) return;
        if (hidden) {
            if (!el.hasAttribute('data-yud-prev-display')) el.setAttribute('data-yud-prev-display', el.style.display || '');
            el.setAttribute(FOOTER_FLAG_ATTR, '1');
            el.style.setProperty('display', 'none', 'important');
        } else if (el.hasAttribute(FOOTER_FLAG_ATTR)) {
            const previous = el.getAttribute('data-yud-prev-display') || '';
            if (previous) el.style.display = previous;
            else el.style.removeProperty('display');
            el.removeAttribute('data-yud-prev-display');
            el.removeAttribute(FOOTER_FLAG_ATTR);
        }
    }
    function candidateFooterContainers(doc) {
        const found = new Set();
        if (!doc || typeof doc.querySelectorAll !== 'function') return found;
        FOOTER_SELECTORS.forEach(selector => {
            doc.querySelectorAll(selector).forEach(el => found.add(el));
        });
        doc.querySelectorAll(FOOTER_BUTTON_SELECTORS.join(',')).forEach(control => {
            const text = footerText(control);
            if (!isSaveLabel(text) && !isCloseLabel(text)) return;
            let parent = control;
            for (let depth = 0; depth < 6 && parent; depth += 1) {
                if (footerBarLooksLikeSaveCloseBar(parent)) found.add(parent);
                parent = parent.parentElement;
            }
        });
        return found;
    }
    function setLegacyFooterVisibility(hidden) {
        eachRelevantDocument(doc => {
            candidateFooterContainers(doc).forEach(el => {
                if (!footerBarLooksLikeSaveCloseBar(el)) return;
                setElementHidden(el, hidden);
            });
        });
    }
    function startLegacyFooterHider() {
        setLegacyFooterVisibility(true);
        footerObserver = [];
        eachRelevantDocument(doc => {
            try {
                const root = doc.body || doc.documentElement;
                if (!root) return;
                const observer = new MutationObserver(() => setLegacyFooterVisibility(true));
                observer.observe(root, { childList: true, subtree: true, characterData: true });
                footerObserver.push(observer);
            } catch (_e) {}
        });
    }
    function stopLegacyFooterHider() {
        if (Array.isArray(footerObserver)) footerObserver.forEach(observer => observer.disconnect());
        footerObserver = null;
        setLegacyFooterVisibility(false);
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
            window.load({devices:response.devices,bindings:response.bindings,oauthUserId:response.oauthUserId,serverHost:response.serverHost,serverPort:response.serverPort,oauthConfigured:response.oauthConfigured}, change);
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
        startLegacyFooterHider();
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
        window.addEventListener('pagehide', stopLegacyFooterHider);
        window.addEventListener('beforeunload', event => {
            if (!dirty) return;
            stopLegacyFooterHider();
            event.preventDefault();
            event.returnValue = '';
        });
    });
})();
