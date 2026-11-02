/* Integration tests: install and run the real adapter in a temporary ioBroker js-controller. */
'use strict';
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { tests } = require('@iobroker/testing');

const root = path.join(__dirname, '..');
const HEALTH_URL = 'http://127.0.0.1:8096/provider/v1.0/';
function request(pathname = '/provider/v1.0/', method = 'HEAD') {
    return new Promise((resolve, reject) => {
        const req = http.request(new URL(pathname, HEALTH_URL), { method, timeout: 2500 }, res => {
            res.resume();
            res.on('end', () => resolve(res.statusCode));
        });
        req.on('timeout', () => req.destroy(new Error('HTTP health request timed out')));
        req.on('error', reject);
        req.end();
    });
}
async function waitForHttp() {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt++) {
        try { return await request(); }
        catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 250));
        }
    }
    throw new Error(`Adapter did not expose its local provider health endpoint: ${lastError?.message}`);
}

tests.integration(root, {
    defineAdditionalTests({ suite }) {
        suite('Provider HTTP lifecycle', getHarness => {
            let harness;
            before(() => { harness = getHarness(); });
            it('starts and exposes a local provider health endpoint', async function () {
                this.timeout(45000);
                await harness.startAdapterAndWait();
                assert.equal(await waitForHttp(), 200);
                assert.equal(await request('/provider/v1.0/user/devices', 'GET'), 401,
                    'private device discovery must require a Bearer token');
                assert.equal(await request('/provider/v1.0/user/devices/action', 'POST'), 401,
                    'device commands must reject unauthenticated callers');
            });
        });
    }
});
