'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');

test('sidebar diagnostic button runs only backend OAuth diagnostic without browser secrets',()=>{
    const editor=read('admin/editor.js');
    const tab=read('admin/tab_m.html');
    const admin=read('admin/tab-controller.js');
    const main=read('main.js');
    assert.match(tab,/data-view="diagnostic"/);
    assert.match(editor,/data-action="oauth-diagnostic"/);
    assert.match(editor,/send\('oauthDiagnostic', \{\}/);
    assert.match(editor,/oauthDiagnosticMarkup\(\)/);
    assert.match(admin,/command === 'oauthDiagnostic' \? 46000/);
    assert.match(main,/msg.command === 'oauthDiagnostic'/);
    assert.match(main,/runOAuthDiagnostic\(\{ server:this.server, oauth:this.oauth, bridge:this.bridge, config:this.config \}\)/);
    const service=read('lib/diagnostics.js');
    assert.doesNotMatch(service,/\/user\/devices\/action|\/user\/unlink/);
    assert.match(service,/oauth\.revokeDiagnosticTokens/);
});
