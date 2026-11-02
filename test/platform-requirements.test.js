'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const io = require('../io-package.json');

test('platform version requirements match ioBroker catalog rules', () => {
    assert.equal(pkg.engines.node, '>=22.19.0');
    assert.deepEqual(io.common.dependencies, [{ 'js-controller': '>=6.0.11' }]);
    assert.deepEqual(io.common.globalDependencies, [{ admin: '>=7.6.17' }]);
    assert.equal(pkg.dependencies['@iobroker/adapter-core'], '^3.4.3');
    assert.equal(pkg.devDependencies['@iobroker/testing'], '^6.3.1');
    assert.equal(pkg.devDependencies.mocha, undefined, 'Mocha is provided by @iobroker/testing');
});

test('CI matrix covers Node.js 22 and 24, but not unsupported Node.js 20', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    assert.match(workflow, /node: \['22', '24'\]/);
    assert.doesNotMatch(workflow, /node: \['20'/);
});
