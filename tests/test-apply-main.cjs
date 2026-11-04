'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const { modifyArchive, ENTRY } = require('../src/apply-main.cjs');
const ENTRY_PATH = ENTRY.split('/').join(path.sep);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zts-asar-'));
  const root = path.join(dir, 'root');
  const mainFile = path.join(root, ...ENTRY.split('/'));
  fs.mkdirSync(path.dirname(mainFile), { recursive: true });
  const original = "import { app } from 'electron';\nconsole.log('main');\n";
  fs.writeFileSync(mainFile, original);
  const archive = path.join(dir, 'app.asar');
  const loader = path.join(dir, 'main-loader.cjs');
  fs.writeFileSync(loader, 'module.exports = {};\n');
  await asar.createPackageWithOptions(root, archive, { unpack: '*.{node,dll,exe}' });

  await modifyArchive(archive, loader, 'apply');
  let archiveBytes = fs.readFileSync(archive);
  assert(archiveBytes.includes(Buffer.from('zts-loader')));
  assert.strictEqual(fs.existsSync(`${archive}.before-apply`), false);

  await modifyArchive(archive, null, 'remove');
  archiveBytes = fs.readFileSync(archive);
  assert(!archiveBytes.includes(Buffer.from('zts-loader')));
  assert.strictEqual(fs.existsSync(`${archive}.before-remove`), false);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('asar main-loader tests passed');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
