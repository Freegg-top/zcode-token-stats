'use strict';

/**
 * Apply/remove the direct-sqlite main-process loader in an app.asar.
 *
 * The archive is unpacked into a temporary directory and repacked there. The
 * original archive is replaced only after the temporary archive verifies. No
 * permanent full-asar backup is created; uninstall removes only the loader
 * line from the main entry.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');
const loaderPatch = require('./patch-loader.cjs');

const ENTRY = 'out/main/index.js';
const ENTRY_PATH = ENTRY.split('/').join(path.sep);

async function modifyArchive(archive, loaderFile, operation) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zts-main-'));
  const packed = path.join(temp, 'app.asar');
  try {
    asar.extractAll(archive, temp);
    const mainFile = path.join(temp, ENTRY_PATH);
    if (!fs.existsSync(mainFile)) throw new Error(`Main entry not found: ${ENTRY}`);
    if (operation === 'apply') loaderPatch.apply(mainFile, loaderFile);
    else if (operation === 'remove') loaderPatch.remove(mainFile);
    else throw new Error(`Unknown operation: ${operation}`);

    await asar.createPackageWithOptions(temp, packed, { unpack: '*.{node,dll,exe}' });
    const check = asar.extractFile(packed, ENTRY_PATH).toString('utf8');
    if (operation === 'apply' && !check.includes(loaderPatch.MARKER)) {
      throw new Error('Loader marker missing after repack');
    }
    if (operation === 'remove' && check.includes(loaderPatch.MARKER)) {
      throw new Error('Loader marker remains after remove');
    }
    fs.copyFileSync(packed, archive);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [operation, archive, loader] = process.argv.slice(2);
  if (!operation || !archive || (operation === 'apply' && !loader)) {
    console.error('Usage: node apply-main.cjs apply <app.asar> <main-loader.cjs> | remove <app.asar>');
    process.exit(2);
  }
  modifyArchive(path.resolve(archive), loader ? path.resolve(loader) : null, operation)
    .then(() => console.log(`Main loader ${operation} complete: ${archive}`))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
}

module.exports = { modifyArchive, ENTRY };
