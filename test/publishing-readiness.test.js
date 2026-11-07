'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('callback debounce uses adapter-managed timer and is cancelled on unload', () => {
    const src=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
    assert.match(src,/this\.callbackTimer = this\.setTimeout\(/);
    assert.match(src,/this\.clearTimeout\(this\.callbackTimer\)/);
    assert.doesNotMatch(src,/this\.callbackTimer = setTimeout\(/);
});

test('standard ioBroker test-and-release workflow checks without automatically publishing', () => {
    const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','test-and-release.yml'),'utf8');
    assert.match(workflow,/ioBroker\/testing-action-check@v2/);
    assert.match(workflow,/ioBroker\/testing-action-adapter@v1/);
    assert.match(workflow,/node-version: '24\.x'/);
    assert.match(workflow,/node-version: \['22\.x', '24\.x', '26\.x'\]/);
    assert.match(workflow,/node-version: \\['22\\.x', '24\\.x', '26\\.x'\\]/);
    assert.match(workflow,/os: \\[ubuntu-latest, windows-latest, macos-latest\\]/);
    assert.match(workflow,/needs: check-and-lint/);
    assert.match(workflow,/group: \\$\\{\\{ github\\.ref \\}\\}/);
    assert.match(workflow,/branches: \\['main', '\\*', '\\*\\*'\\]/);
    assert.match(workflow,/^  deploy:\\s*$/m);
    assert.match(workflow,/^    if: \\$\\{\\{ false \\}\\}/m, 'release publishing MUST remain disabled');
    assert.match(workflow,/ioBroker\\/testing-action-deploy@v1/);
});
