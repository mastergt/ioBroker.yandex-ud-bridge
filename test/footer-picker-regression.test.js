'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin/tab-controller.js'), 'utf8');
const ACTIONS = 'button,a,.btn,input[type=button],input[type=submit]';

function makeDOM() {
    let observers = [];
    function element(ownerDocument, tagName = 'DIV', content = '') {
        const attrs = new Map();
        const el = {
            ownerDocument, tagName,
            content, children: [], parentElement: null,
            style: {
                display: '',
                setProperty(name, value) { if (name === 'display') this.display = value; },
                removeProperty(name) { if (name === 'display') this.display = ''; }
            },
            get innerText() { return this.style.display === 'none' ? '' : this.content; },
            get textContent() { return this.content; },
            hasAttribute(key) { return attrs.has(key); },
            setAttribute(key, value) { attrs.set(key, value); },
            getAttribute(key) { return attrs.get(key) ?? null; },
            removeAttribute(key) { attrs.delete(key); },
            append(child) { this.children.push(child); child.parentElement = this; },
            contains(child) { return this === child || this.children.some(el => el.contains(child)); },
            descendants() { return this.children.flatMap(el => [el, ...el.descendants()]); },
            querySelectorAll(selector) {
                if (selector === ACTIONS) return this.descendants().filter(x => ['BUTTON', 'A', 'INPUT'].includes(x.tagName));
                if (selector === `[data-yud-hide-legacy-footer]`) return this.descendants().filter(x => x.hasAttribute('data-yud-hide-legacy-footer'));
                return [];
            },
            querySelector(selector) { return selector === '.bridge-root' ? this.descendants().find(el => el.isBridgeRoot) || null : null; },
            addEventListener() {},
            focus() {}
        };
        return el;
    }
    function documentStub() {
        const doc = {
            finders: new Map(),
            events: new Map(),
            querySelectorAll(selector) {
                this.queryCount += 1;
                if (selector === '.adminButtons') return this.footer ? [this.footer] : [];
                if (selector === '.buttons') return this.genericActions ? [this.genericActions] : [];
                return this.body.querySelectorAll(selector);
            },
            getElementById(id) {
                if (!this.finders.has(id)) {
                    this.finders.set(id, {textContent: '', className: '', disabled: false, addEventListener() {}});
                }
                return this.finders.get(id);
            },
            addEventListener(name, cb) { this.events.set(name, cb); },
            queryCount: 0
        };
        doc.body = element(doc, 'BODY', '');
        doc.documentElement = element(doc, 'HTML', '');
        doc.documentElement.append(doc.body);
        return doc;
    }
    const inside = documentStub();
    const outside = documentStub();
    const frame = element(outside, 'IFRAME');
    const root = element(outside, 'DIV', 'Сохранить Отмена');
    root.append(frame);
    outside.body.append(root);
    outside.genericActions = root;
    const footer = element(outside, 'DIV', 'SAVE СОХРАНИТЬ SAVE CLOSE ЗАКРЫТЬ');
    footer.append(element(outside, 'BUTTON', 'SAVE СОХРАНИТЬ'));
    footer.append(element(outside, 'BUTTON', 'SAVE CLOSE СОХРАНИТЬ И ВЫЙТИ'));
    footer.append(element(outside, 'BUTTON', 'CLOSE ЗАКРЫТЬ'));
    outside.body.append(footer);
    outside.footer = footer;

    const editor = element(inside, 'DIV', 'Сохранить изменения');
    editor.isBridgeRoot = true;
    const workspace = element(inside, 'MAIN');
    const topbar = element(inside, 'HEADER');
    const toolbar = element(inside, 'DIV');
    const save = element(inside, 'BUTTON', 'Сохранить изменения');
    toolbar.append(save);
    topbar.append(toolbar);
    workspace.append(topbar);
    editor.append(workspace);
    inside.body.append(editor);
    inside.body.content = 'Сохранить изменения';
    const dialog = element(inside, 'DIALOG', 'Отмена');
    inside.body.append(dialog);
    const hostWindow = {document: outside};
    const instance = {
        parent: hostWindow, top: hostWindow, frameElement: frame,
        location: {search: '?instance=0'},
        socket: {emit(_action, _instance, command, _data, callback) {
            if (command === 'getTabConfig') callback({revision:'rev1',devices:[],bindings:[]});
            else throw new Error(`Unexpected command ${command}`);
        }},
        load(_data, callback) { callback(false); },
        addEventListener(name, fn) { this.events.set(name, fn); },
        events: new Map(),
        setTimeout() {}
    };
    const sandbox = {
        window: instance,
        document: inside,
        URLSearchParams,
        clearTimeout() {},
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observers.push(this); }
            observe(target) { this.root = target; }
            disconnect() { this.disconnected = true; }
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return {inside, outside, frame, footer, root, instance, observers,
        start() { inside.events.get('DOMContentLoaded')(); },
        update() { for (const obs of observers) if (!obs.disconnected) obs.callback(); }
    };
}

test('legacy Admin footer is hidden without hiding iframe, editor, or native state dialog', () => {
    const f = makeDOM();
    f.start();
    assert.equal(f.footer.style.display, 'none', 'old Admin buttons are still suppressed');
    assert.equal(f.root.style.display, '', 'parent container holding the editor remains visible');
    assert.equal(f.outside.body.style.display, '', 'parent body must not be hidden');
    assert.equal(f.inside.body.style.display, '', 'editor body must never be hidden by footer handler');
    assert.equal(f.inside.queryCount, 0, 'the handler must not scan the active editor document');
    assert.equal(f.observers.length, 1, 'watch only the parent Admin document');

    // The picker opening introduces both "Сохранить" and "Отмена" in the
    // document text. The old code hid <body> on an observed mutation.
    f.inside.body.content = 'Сохранить изменения / Отмена / Выбор состояния ioBroker';
    f.update();
    assert.equal(f.inside.body.style.display, '');
    assert.equal(f.root.style.display, '');
    assert.equal(f.footer.style.display, 'none');

    f.instance.events.get('pagehide')();
    assert.equal(f.footer.style.display, '', 'closing the tab restores the legacy footer');
    assert.equal(f.footer.hasAttribute('data-yud-hide-legacy-footer'), false);
});

test('footer handler does not modify standalone tab with no parent Admin window', () => {
    const f = makeDOM();
    f.instance.parent = f.instance;
    f.instance.top = f.instance;
    f.start();
    assert.equal(f.observers.length, 0);
    assert.equal(f.inside.queryCount, 0);
    assert.equal(f.inside.body.style.display, '');
});
