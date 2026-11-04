'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const loaderPatch = require('../src/patch-loader.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zts-loader-'));
const mainFile = path.join(dir, 'index.js');
const loaderFile = path.join(dir, 'main-loader.cjs');
const original = "import { app } from 'electron';\nconsole.log('main');\n";
fs.writeFileSync(mainFile, original);
fs.writeFileSync(loaderFile, 'module.exports = {};\n');

assert.strictEqual(loaderPatch.isPatched(mainFile), false);
loaderPatch.apply(mainFile, loaderFile);
assert.strictEqual(loaderPatch.isPatched(mainFile), true);
assert(fs.readFileSync(mainFile, 'utf8').includes('zts-loader'));
assert.strictEqual(loaderPatch.remove(mainFile).changed, true);
assert.strictEqual(fs.readFileSync(mainFile, 'utf8'), original);
assert.strictEqual(loaderPatch.remove(mainFile).changed, false);

const otherPatch = `${original}\n/* another-tool */\nimport('./other.js');\n`;
fs.writeFileSync(mainFile, otherPatch);
loaderPatch.apply(mainFile, loaderFile);
assert(fs.readFileSync(mainFile, 'utf8').includes('another-tool'));
loaderPatch.remove(mainFile);
assert.strictEqual(fs.readFileSync(mainFile, 'utf8'), otherPatch);

fs.rmSync(dir, { recursive: true, force: true });
console.log('loader patch tests passed');
