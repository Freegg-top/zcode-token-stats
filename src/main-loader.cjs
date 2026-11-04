'use strict';

/**
 * Electron main-process loader prototype.
 *
 * Loaded from out/main/index.js through a single injected import. It reads
 * ZCode's SQLite database directly, watches WAL writes, and pushes a snapshot
 * to the renderer through a DOM CustomEvent. No Python process and no
 * zcode.cjs patch are required.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, webContents } = require('electron');
const { openDb, usageSnapshot } = require('./sqlite-usage.cjs');

const DB = process.env.ZTS_DB || path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
let db = null;
let timer = null;
let watcher = null;
let lastPush = 0;

function getDb() {
  if (!db) db = openDb(DB);
  return db;
}

function escapeForScript(value) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

async function readWindowState(wc) {
  try {
    return await wc.executeJavaScript(`({
      sessionId: window.__ztsSessionId || "",
      contextWindow: Number(window.__ztsContextWindow) || null
    })`, true) ?? {};
  } catch {
    return {};
  }
}

async function tick() {
  if (!fs.existsSync(DB)) return;
  const now = Date.now();
  if (now - lastPush < 250) return;
  lastPush = now;
  for (const wc of webContents.getAllWebContents()) {
    if (!wc || wc.isDestroyed()) continue;
    const state = await readWindowState(wc);
    if (!state.sessionId) continue;
    try {
      const snapshot = usageSnapshot(getDb(), state.sessionId, new Date(), state.contextWindow);
      const detail = escapeForScript(snapshot);
      await wc.executeJavaScript(
        `window.dispatchEvent(new CustomEvent("ztsSnapshot", { detail: ${detail} }))`,
        true,
      );
    } catch (error) {
      // A window may disappear while the database is being updated.
      console.error('[zts] usage push failed:', error?.message ?? error);
    }
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    tick().catch(error => console.error('[zts] tick failed:', error?.message ?? error));
  }, 300);
  if (timer.unref) timer.unref();
}

function start() {
  if (globalThis.__ztsMainLoader) return;
  globalThis.__ztsMainLoader = true;
  try {
    watcher = fs.watch(path.dirname(DB), (_event, name) => {
      if (!name || /^db\.sqlite(?:-(?:wal|shm))?$/u.test(name)) schedule();
    });
    if (watcher.unref) watcher.unref();
  } catch (error) {
    console.error('[zts] database watch unavailable:', error?.message ?? error);
  }
  const heartbeat = setInterval(() => tick().catch(() => {}), 2000);
  if (heartbeat.unref) heartbeat.unref();
  app.whenReady().then(() => tick().catch(() => {}));
}

app.whenReady().then(start).catch(error => {
  console.error('[zts] main loader failed:', error?.message ?? error);
});
