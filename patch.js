// Install, inspect, or remove the local Token indicator using official ASAR tooling.
// Fully exit ZCode (including its tray icon) before apply/remove.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');
const { buildPatch, removePatch, analyzePatch, sha256, readHeader, readFile } = require('./patch-lib.js');
const { parse } = require('./auto-patch.cjs');
const cliPatch = require('./cli-patch.cjs');

const command = process.argv[2] || 'apply';
// Resolve the target archive from the CLI argument, then $ZCODE_ASAR, then the
// default per-user install location. Pass an explicit path for custom installs.
const archive = path.resolve(process.argv[3] || process.env.ZCODE_ASAR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Programs', 'ZCode', 'resources', 'app.asar'));
const cliFile = path.join(path.dirname(archive), 'glm', 'zcode.cjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-token-speed-'));
const transactionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-token-speed-transaction-'));
const packed = path.join(tempRoot, 'app.asar');
const unpackedRoot = `${archive}.unpacked`;
const backupRoot = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ZCodeTokenStats', 'backup');
fs.mkdirSync(backupRoot, { recursive: true });

function hashDirectory(root) {
  if (!fs.existsSync(root)) return null;
  const hash = crypto.createHash('sha256');
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      hash.update(path.relative(root, file));
      if (entry.isDirectory()) visit(file);
      else hash.update(fs.readFileSync(file));
    }
  }
  visit(root);
  return hash.digest('hex');
}

/**
 * Find the renderer chunk by content, not by the Vite content hash. The stats
 * component and composer usage marker have stable names across minified builds.
 */
function findRendererBundle(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  try {
    const { header, base } = readHeader(fd);
    const candidates = [];
    (function visit(node, prefix) {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const entry = prefix ? `${prefix}/${name}` : name;
        if (child.files) {
          visit(child, entry);
          continue;
        }
        if (!/^out\/renderer\/assets\/.+\.js$/u.test(entry)) continue;
        if (!child.size || child.size < 50_000) continue;
        candidates.push({ entry, node: child });
      }
    })(header, '');
    candidates.sort((left, right) => {
      const leftStyles = /\/styles-[^/]+\.js$/u.test(left.entry) ? 1 : 0;
      const rightStyles = /\/styles-[^/]+\.js$/u.test(right.entry) ? 1 : 0;
      return rightStyles - leftStyles || right.node.size - left.node.size;
    });
    const matches = [];
    for (const candidate of candidates) {
      let text;
      if (candidate.node.unpacked) {
        const disk = path.join(path.dirname(archivePath), `${path.basename(archivePath)}.unpacked`, candidate.entry.split('/').join(path.sep));
        if (!fs.existsSync(disk)) continue;
        text = fs.readFileSync(disk, 'utf8');
      } else {
        text = readFile(fd, base, candidate.node).toString('utf8');
      }
      if (!text.includes('draftConfig')) continue;
      if (text.includes('data-usage-used') || text.includes('token-speed-indicator')) matches.push({ entry: candidate.entry, source: text });
    }
    if (matches.length !== 1) {
      throw new Error(`Renderer feature matched ${matches.length} bundles (expected exactly 1). ZCode changed its composer structure; refusing unsafe install.`);
    }
    return matches[0];
  } finally {
    fs.closeSync(fd);
  }
}

function inspect() {
  const found = findRendererBundle(archive);
  const support = analyzePatch(found.source);
  return { ...found, patched: found.source.includes('token-speed-indicator'), support };
}

function cleanupTimestampedBackups() {
  for (const directory of [__dirname, backupRoot]) {
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory)) {
      if (!/^app\.asar(?:\.unpacked)?\.(?:before-|backup-)/u.test(name)) continue;
      fs.rmSync(path.join(directory, name), { recursive: true, force: true });
    }
  }
}

function backupNative(destination) {
  const stat = fs.statSync(destination, { throwIfNoEntry: false });
  if (!stat) return;
  if (hashDirectory(unpackedRoot) !== hashDirectory(destination)) throw new Error('Native unpacked backup hash mismatch');
}

async function main() {
  try {
    const current = inspect();
    if (command === 'check') {
      console.log(JSON.stringify({
        archive,
        sha256: sha256(archive),
        bundle: current.entry,
        patched: current.patched,
        cliPatched: cliPatch.cliPatched(cliFile),
        autoAdaptable: current.support.compatible,
        component: current.support.component ?? null,
        callSites: current.support.callSites ?? null,
        aliases: current.support.aliases ?? null,
        error: current.support.error ?? null,
      }, null, 2));
      return;
    }
    if (command !== 'apply' && command !== 'remove') {
      throw new Error(`Unknown command: ${command}. Use apply, remove, or check.`);
    }
    const applying = command === 'apply';
    if (!current.patched && !applying) {
      console.log('Token/s patch is not installed.');
      return;
    }
    if (applying && !current.support.compatible) {
      throw new Error(`This ZCode version is not safely patchable: ${current.support.error}`);
    }
    if (current.patched && applying) {
      console.log('Existing Token/s patch detected; upgrading it in place.');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(backupRoot, 'app.asar.zts-original');
    const nativeBackup = path.join(backupRoot, 'app.asar.unpacked.zts-original');
    const legacyBackup = path.join(__dirname, 'app.asar.zts-original');
    const legacyNativeBackup = path.join(__dirname, 'app.asar.unpacked.zts-original');
    const transactionBackup = path.join(transactionRoot, 'app.asar.transaction');
    const transactionNative = path.join(transactionRoot, 'app.asar.unpacked.transaction');
    fs.copyFileSync(archive, transactionBackup, fs.constants.COPYFILE_EXCL);
    if (fs.existsSync(unpackedRoot)) {
      fs.cpSync(unpackedRoot, transactionNative, { recursive: true, errorOnExist: true });
    }

    if (!fs.existsSync(backup) && fs.existsSync(legacyBackup)) {
      fs.copyFileSync(legacyBackup, backup);
      fs.rmSync(legacyBackup, { force: true });
    }
    if (!fs.existsSync(nativeBackup) && fs.existsSync(legacyNativeBackup)) {
      fs.cpSync(legacyNativeBackup, nativeBackup, { recursive: true });
      fs.rmSync(legacyNativeBackup, { recursive: true, force: true });
    }
    if (!current.patched || !fs.existsSync(backup)) {
      if (current.patched) {
        const previous = fs.readdirSync(__dirname)
          .filter(name => /^app\.asar\.before-/u.test(name))
          .sort()
          .reverse()[0];
        if (previous) fs.copyFileSync(path.join(__dirname, previous), backup);
        else fs.copyFileSync(archive, backup);
      } else {
        fs.copyFileSync(archive, backup);
      }
    }
    if (!current.patched && fs.existsSync(unpackedRoot)) {
      fs.rmSync(nativeBackup, { recursive: true, force: true });
      fs.cpSync(unpackedRoot, nativeBackup, { recursive: true });
    } else if (!fs.existsSync(nativeBackup) && fs.existsSync(unpackedRoot)) {
      fs.cpSync(unpackedRoot, nativeBackup, { recursive: true });
    }
    let cliBackup = null;
    try {
      asar.extractAll(archive, tempRoot);
      const target = path.join(tempRoot, current.entry.split('/').join(path.sep));
      const source = fs.readFileSync(target, 'utf8');
      const restored = current.patched ? removePatch(source) : null;
      if (current.patched && restored === null) throw new Error('Installed Token/s patch could not be located safely');
      const base = restored ?? source;
      const plan = applying ? analyzePatch(base) : null;
      if (applying && !plan.compatible) throw new Error(`Automatic structural match failed: ${plan.error}`);
      const transformed = applying ? buildPatch(base) : restored;
      fs.writeFileSync(target, transformed);
      await asar.createPackageWithOptions(tempRoot, packed, { unpack: '*.{node,dll,exe}' });

      const next = findRendererBundle(packed);
      if (next.source.includes('token-speed-indicator') !== applying) throw new Error('Patched archive verification failed');
      parse(next.source);
      if (hashDirectory(unpackedRoot) !== hashDirectory(`${packed}.unpacked`)) throw new Error('Native unpacked verification failed');
      fs.copyFileSync(packed, archive);
      if (fs.existsSync(unpackedRoot)) fs.rmSync(unpackedRoot, { recursive: true });
      if (fs.existsSync(`${packed}.unpacked`)) fs.cpSync(`${packed}.unpacked`, unpackedRoot, { recursive: true });
      if (applying) {
        const cliResult = cliPatch.applyCli(cliFile, stamp);
        cliBackup = cliResult.backup ?? null;
        if (cliResult.skipped) {
          console.warn(`Token/s renderer installed, but zcode.cjs was not patched: ${cliResult.reason}. Child cache totals may remain incomplete.`);
        } else if (cliResult.changed) {
          console.log(`Patched zcode.cjs full usage query. Backup: ${cliResult.backup}`);
        } else {
          console.log('zcode.cjs full usage query is already patched.');
        }
        console.log(`Installed Token/s patch for component ${plan.component} (${plan.callSites} call site(s)).`);
        cleanupTimestampedBackups();
      } else {
        const cliResult = cliPatch.removeCli(cliFile);
        if (cliResult.changed) console.log(`Restored zcode.cjs${cliResult.restoredFrom ? ` from ${cliResult.restoredFrom}` : ''}.`);
        fs.rmSync(backup, { force: true });
        fs.rmSync(nativeBackup, { recursive: true, force: true });
        cleanupTimestampedBackups();
        try { fs.rmdirSync(backupRoot); } catch {}
        console.log('Removed Token/s patch.');
      }
      console.log(`Bundle: ${current.entry}\nBackup: ${applying ? backup : '(removed)'}\nRestart ZCode completely.`);
    } catch (error) {
      fs.copyFileSync(transactionBackup, archive);
      if (fs.existsSync(unpackedRoot)) fs.rmSync(unpackedRoot, { recursive: true });
      if (fs.existsSync(transactionNative)) fs.cpSync(transactionNative, unpackedRoot, { recursive: true });
      if (cliBackup) cliPatch.restoreCli(cliFile, cliBackup);
      throw new Error(`Operation failed; previous archive restored. ${error.message}`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
