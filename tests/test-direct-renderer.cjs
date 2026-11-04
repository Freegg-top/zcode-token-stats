'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const lib = require('../patch-lib.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'minimal-renderer.js'), 'utf8');
const patched = lib.buildPatch(fixture, { componentFile: './renderer-direct-component.txt' });
assert.strictEqual(lib.removePatch(patched), fixture, 'direct renderer must be exactly reversible');
assert(patched.includes('ztsSnapshot'), 'direct renderer listens to the loader event');
assert(/createPortal\(/.test(patched), 'detail panel must portal to document.body so position:fixed ignores transformed ancestors');
assert(/__ztsVersion=`\d+\.\d+\.\d+`/.test(patched), 'patch must embed its version marker for update detection');
assert(patched.includes('模型用时'));
assert(patched.includes('工具调用用时'));
assert(patched.includes('首 Token 平均（TTFT）'));
assert(patched.includes('输出速度（TPS）'));
assert(patched.includes('今日'));
assert(patched.includes('项目'));
assert(!patched.includes('子代理用量已计入合计'));
console.log('direct renderer test passed');
