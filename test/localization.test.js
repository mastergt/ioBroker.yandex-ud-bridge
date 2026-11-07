'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const supported = ['en', 'de', 'ru', 'es', 'fr', 'it', 'nl', 'pt', 'pl', 'uk', 'zh-cn'];
const config = require('../admin/jsonConfig.json');
const metadata = require('../io-package.json');
const pkg = require('../package.json');
const translations = Object.fromEntries(supported.map(language => [language, JSON.parse(
    fs.readFileSync(path.join(root, 'admin', 'i18n', language, 'translations.json'), 'utf8'),
)]));

function translatableFields() {
    const fields = [];
    for (const [tabId, tab] of Object.entries(config.items)) {
        if (tab.label) fields.push({ key: tab.label, field: `${tabId}.label` });
        for (const [id, component] of Object.entries(tab.items)) {
            for (const name of ['label', 'help', 'tooltip', 'text']) {
                if (component[name]) fields.push({ key: component[name], field: `${tabId}.${id}.${name}` });
            }
        }
    }
    return fields;
}

test('11 locales have meaningful translations for every JSON Config label and help text', () => {
    assert.equal(config.i18n, true);
    assert.equal(config.type, 'tabs');
    const fields = translatableFields();
    assert.ok(fields.length >= 30, 'include security explanations and OAuth help');
    for (const { key, field } of fields) {
        assert.equal(typeof key, 'string', field);
        assert.match(key, /\./, `${field} should use a stable semantic key`);
    }
    const keys = fields.map(field => field.key);
    assert.equal(new Set(keys).size, keys.length, 'unique translation keys');
    for (const lang of supported) {
        const translationsForLanguage = translations[lang];
        assert.deepEqual(Object.keys(translationsForLanguage), keys, `missing, outdated or duplicate keys for ${lang}`);
        for (const [key, label] of Object.entries(translationsForLanguage)) {
            assert.equal(typeof label, 'string', `${lang}:${key}`);
            assert.ok(label.trim().length >= 2, `${lang}:${key} is not translated`);
        }
        for (const key of ['server._urlHelp.label', 'server.trustProxy.help']) {
            assert.ok(translationsForLanguage[key].includes('https://smart.example.com') ||
                translationsForLanguage[key].includes('$remote_addr'), `${lang}:${key}: keep URLs and Nginx variables`);
        }
    }
});

test('metadata and complete release notes use all 11 ioBroker languages', () => {
    const common = metadata.common;
    assert.equal(pkg.version, common.version);
    assert.equal(pkg.version, '0.3.26');
    for (const [name, translationsByLanguage] of [
        ['titleLang', common.titleLang],
        ['desc', common.desc],
        ['adminTab.name', common.adminTab.name],
        ...Object.entries(common.news).map(([version, news]) => [`news.${version}`, news]),
    ]) {
        assert.deepEqual([...Object.keys(translationsByLanguage)].sort(), [...supported].sort(), name);
        for (const lang of supported) {
            assert.ok(translationsByLanguage[lang].trim().length > 8, `${name}/${lang} is empty`);
        }
    }
});

test('localization changes do not add or mutate runtime configuration keys', () => {
    assert.equal(config.items.oauth.items.oauthClientSecret.type, 'password');
    assert.equal(config.items.oauth.items.oauthPassword.type, 'password');
    assert.equal(config.items.callbacks.items.callbackOauthToken.type, 'password');
    assert.equal(config.items.server.items.trustProxy.type, 'checkbox');
    assert.equal(config.items.oauth.items._createOAuth.command, 'jsonOAuthBootstrap');
    assert.equal(config.items.oauth.items._rotateLogin.command, 'jsonOAuthRotatePassword');
    assert.deepEqual(metadata.native.devices, []);
    assert.deepEqual(metadata.native.bindings, []);
});
