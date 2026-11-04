'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const lib = require('../patch-lib.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'minimal-renderer.js'), 'utf8');
const patched = lib.buildPatch(fixture);
const analysis = lib.analyzePatch(fixture);

assert.strictEqual(analysis.compatible, true);
assert.strictEqual(analysis.component, 'Composer');
assert.strictEqual(analysis.callSites, 1);
assert.deepStrictEqual(analysis.aliases, { react: 'Q', jsx: '$', portal: 'im', services: 'ed' });
assert.strictEqual((patched.match(/data-ztp-stat/g) || []).length, 2);
assert(patched.includes('data-ztp-panel'));
assert(patched.includes('gridTemplateColumns'));
assert(patched.includes('pendingIds'));
assert(patched.includes('workflowRuns'));
assert(patched.includes('full per-request sum'));
assert(patched.includes('模型用时'));
assert(patched.includes('输出速度（TPS）'));
assert(!patched.includes('子代理用量已计入合计'));
assert.strictEqual(lib.removePatch(patched), fixture, 'fixture patch removal must restore exact source');

console.log(JSON.stringify({
  result: 'passed',
  component: analysis.component,
  aliases: analysis.aliases,
  callSites: analysis.callSites,
}, null, 2));
