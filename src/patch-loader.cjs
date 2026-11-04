'use strict';

/**
 * Append/remove one loader import line in a main entry file.
 *
 * This operates on a plain extracted out/main/index.js. The installer is
 * responsible for extracting/repacking app.asar with a temporary transaction
 * directory. Unlike the old renderer patch, there is no permanent full-asar
 * backup: uninstall removes only this loader line.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MARKER = 'zts-loader';

function buildLine(loaderFile) {
  const url = pathToFileURL(path.resolve(loaderFile)).href;
  return `\n/* ${MARKER} */\n;import(${JSON.stringify(url)}).catch((e) => console.error("[zts] loader failed", e));\n`;
}

function apply(mainFile, loaderFile) {
  const source = fs.readFileSync(mainFile, 'utf8');
  remove(mainFile);
  fs.appendFileSync(mainFile, buildLine(loaderFile), 'utf8');
  return { changed: true };
}

function remove(mainFile) {
  const source = fs.readFileSync(mainFile, 'utf8');
  const pattern = new RegExp(`\\n?\\/\\* ${MARKER} \\*\\/\\n?;?import\\([^\\n]+\\)\\.catch\\([^\\n]+\\);\\n?`, 'u');
  if (!pattern.test(source)) return { changed: false };
  fs.writeFileSync(mainFile, source.replace(pattern, ''), 'utf8');
  return { changed: true };
}

function isPatched(mainFile) {
  return fs.readFileSync(mainFile, 'utf8').includes(`/* ${MARKER} */`);
}

module.exports = { apply, remove, isPatched, buildLine, MARKER };
