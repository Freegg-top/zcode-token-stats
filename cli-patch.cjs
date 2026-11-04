'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MARKER = '/*zts-full-usage*/';
const OLD_C = 'C=I===void 0?k:Math.max(0,k-(_[I]??0))';
const NEW_C = `C=k${MARKER}`;
const OLD_CACHE = 'I===void 0&&(u+=Number(v.cacheCreationTokens??0),f+=Number(v.cacheReadTokens??0))';
const NEW_CACHE = '(u+=Number(v.cacheCreationTokens??0),f+=Number(v.cacheReadTokens??0))';

function backupPath(cliFile) {
  return path.join(path.dirname(cliFile), `${path.basename(cliFile)}.before-token-stats`);
}

function findLatestBackup(cliFile) {
  const directory = path.dirname(cliFile);
  const base = path.basename(cliFile);
  const fixed = backupPath(cliFile);
  if (fs.existsSync(fixed)) return fixed;
  const backups = fs.readdirSync(directory)
    .filter(name => name.startsWith(`${base}.before-token-stats-`))
    .sort()
    .reverse();
  return backups.length > 0 ? path.join(directory, backups[0]) : null;
}

function cleanupOldBackups(cliFile) {
  const directory = path.dirname(cliFile);
  const base = path.basename(cliFile);
  const fixed = backupPath(cliFile);
  for (const name of fs.readdirSync(directory)) {
    if (name === path.basename(fixed)) continue;
    if (name.startsWith(`${base}.before-token-stats-`)) {
      fs.rmSync(path.join(directory, name), { force: true });
    }
  }
}

function checkSyntax(file) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.error) return result.error.message;
  if (result.status !== 0) return (result.stderr || result.stdout || '').trim().slice(0, 500);
  return null;
}

function applyCli(cliFile, stamp) {
  if (!fs.existsSync(cliFile)) return { changed: false, skipped: true, reason: 'zcode.cjs not found' };
  const source = fs.readFileSync(cliFile, 'utf8');
  if (source.includes(MARKER)) {
    cleanupOldBackups(cliFile);
    return { changed: false, skipped: false, already: true };
  }
  if (!source.includes(OLD_C) || !source.includes(OLD_CACHE)) {
    return { changed: false, skipped: true, reason: 'zcode.cjs usage query target not recognized' };
  }
  const backup = backupPath(cliFile);
  fs.copyFileSync(cliFile, backup);
  const patched = source.replace(OLD_C, NEW_C).replace(OLD_CACHE, NEW_CACHE);
  fs.writeFileSync(cliFile, patched);
  const syntaxError = checkSyntax(cliFile);
  if (syntaxError) {
    fs.copyFileSync(backup, cliFile);
    throw new Error(`zcode.cjs syntax check failed; restored backup: ${syntaxError}`);
  }
  cleanupOldBackups(cliFile);
  return { changed: true, skipped: false, backup };
}

function restoreCli(cliFile, backup) {
  if (!backup || !fs.existsSync(backup)) return false;
  fs.copyFileSync(backup, cliFile);
  return true;
}

function removeCli(cliFile) {
  if (!fs.existsSync(cliFile)) return { changed: false, skipped: true };
  const source = fs.readFileSync(cliFile, 'utf8');
  if (!source.includes(MARKER)) {
    return { changed: false, skipped: false, already: true };
  }
  const backup = findLatestBackup(cliFile);
  if (backup) {
    fs.copyFileSync(backup, cliFile);
    fs.rmSync(backup, { force: true });
    cleanupOldBackups(cliFile);
    return { changed: true, skipped: false, restoredFrom: backup };
  }
  const restored = source.replace(NEW_C, OLD_C).replace(NEW_CACHE, OLD_CACHE);
  fs.writeFileSync(cliFile, restored);
  const syntaxError = checkSyntax(cliFile);
  if (syntaxError) throw new Error(`zcode.cjs restore syntax check failed: ${syntaxError}`);
  cleanupOldBackups(cliFile);
  return { changed: true, skipped: false, restoredFrom: 'reverse replacement' };
}

function cliPatched(cliFile) {
  if (!fs.existsSync(cliFile)) return false;
  return fs.readFileSync(cliFile, 'utf8').includes(MARKER);
}

module.exports = { applyCli, removeCli, restoreCli, cliPatched };
