// Text-only patch for the trusted local ZCode renderer; archive packing uses @electron/asar.
const fs = require('fs');
const crypto = require('crypto');

function readHeader(fd) {
  const prefix = Buffer.alloc(16);
  if (fs.readSync(fd, prefix, 0, 16, 0) !== 16 || prefix.readUInt32LE(0) !== 4) throw new Error('Not a supported ASAR archive');
  // Pickle layout: [0..4]=4, [4..8]=header pickle size, [8..12]=pickle len, [12..16]=json string length, [16..]=JSON bytes.
  // Data entries start right after the header pickle: base = 8 + headerPickleSize.
  const headerPickleSize = prefix.readUInt32LE(4);
  const jsonLen = prefix.readUInt32LE(12);
  const buffer = Buffer.alloc(jsonLen);
  fs.readSync(fd, buffer, 0, jsonLen, 16);
  return { header: JSON.parse(buffer.toString('utf8')), base: 8 + headerPickleSize };
}
function parseHeader(buffer) {
  const headerPickleSize = buffer.readUInt32LE(4);
  const jsonLen = buffer.readUInt32LE(12);
  return { header: JSON.parse(buffer.subarray(16, 16 + jsonLen).toString('utf8')), base: 8 + headerPickleSize };
}
function findFile(header, path) {
  let node = header;
  for (const part of path.split('/').filter(Boolean)) {
    node = node.files?.[part];
    if (!node) throw new Error(`ASAR file not found: ${path}`);
  }
  return node;
}
function readFile(fd, base, entry) {
  const buffer = Buffer.alloc(entry.size);
  fs.readSync(fd, buffer, 0, entry.size, base + Number(entry.offset));
  return buffer;
}
function sha256(path) { return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'); }
function replaceOnce(text, before, after, label) {
  const index = text.indexOf(before);
  if (index === -1) throw new Error(`Patch target not found: ${label}`);
  if (text.indexOf(before, index + before.length) !== -1) throw new Error(`Patch target is not unique: ${label}`);
  return text.slice(0, index) + after + text.slice(index + before.length);
}

const { createRuntime } = require('./stats-core.js');
const auto = require('./auto-patch.cjs');

function createHelper(componentFile = './renderer-component.txt') {
  const version = require('./package.json').version;
  const template = fs.readFileSync(require.resolve(componentFile), 'utf8');
  return `${createRuntime()}\n${template.replaceAll('__ZTS_VERSION__', version)}`;
}

function buildPatch(source, options = {}) {
  return auto.build(source, createHelper(options.componentFile)).text;
}

function analyzePatch(source) {
  try {
    if (source.includes('data-testid:`token-speed-indicator`')) return { compatible: true, installed: true };
    const anchor = auto.analyze(source);
    return {
      compatible: true,
      installed: false,
      component: anchor.componentName,
      callSites: anchor.callAnchors.length,
      aliases: anchor.aliases,
    };
  } catch (error) {
    return { compatible: false, installed: source.includes('data-testid:`token-speed-indicator`'), error: error.message };
  }
}

// Older releases had no structural bridge props; keep exact removal support for upgrades.
function removeLegacy(source) {
  let text = source;
  let start = text.indexOf('function ZTN(value)');
  if (start === -1) start = text.indexOf('function ZTF(e)');
  if (start === -1) {
    const legacyStart = text.indexOf('function ZTS(e)');
    if (legacyStart === -1) return null;
    const legacyEnd = text.indexOf('function X0t(', legacyStart);
    if (legacyEnd === -1) throw new Error('Legacy Token/s helper end not found');
    text = text.slice(0, legacyStart) + text.slice(legacyEnd);
    text = replaceOnce(text, '(0,$.jsx)(ZTP,{workspacePath:e,workspaceIdentity:t,sessionId:o,snapshot:tc}),', '', 'legacy badge');
    text = replaceOnce(text, 'draftConfig:d,usage:f,snapshot:tc,disabled:p,', 'draftConfig:d,usage:f,disabled:p,', 'snapshot prop');
    text = replaceOnce(text, 'draftConfig:o,usage:Or,snapshot:e,disabled:Pe||jt,', 'draftConfig:o,usage:Or,disabled:Pe||jt,', 'snapshot argument');
    return text;
  }
  const end = text.indexOf('function X0t(', start);
  if (end === -1) throw new Error('Token speed helper end not found');
  text = text.slice(0, start) + text.slice(end);
  text = replaceOnce(text, '(0,$.jsx)(ZTP,{workspacePath:e,workspaceIdentity:t,sessionId:o,snapshot:tc}),', '', 'speed badge');
  text = replaceOnce(text, 'draftConfig:d,usage:f,snapshot:tc,disabled:p,', 'draftConfig:d,usage:f,disabled:p,', 'snapshot prop');
  text = replaceOnce(text, 'draftConfig:o,usage:Or,snapshot:e,disabled:Pe||jt,', 'draftConfig:o,usage:Or,disabled:Pe||jt,', 'snapshot argument');
  return text;
}

function removePatch(source) {
  try {
    const legacy = removeLegacy(source);
    if (legacy !== null) return legacy;
  } catch {}
  return auto.remove(source);
}

module.exports = {
  readHeader,
  findFile,
  readFile,
  parseHeader,
  sha256,
  replaceOnce,
  buildPatch,
  removePatch,
  analyzePatch,
};
