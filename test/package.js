/* ioBroker official package-files validation; runs in mocha (not node --test). */
'use strict';
const path = require('node:path');
const { tests } = require('@iobroker/testing');
tests.packageFiles(path.join(__dirname, '..'));
