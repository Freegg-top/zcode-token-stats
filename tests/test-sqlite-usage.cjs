'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const usage = require('../src/sqlite-usage.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zts-sqlite-'));
const dbPath = path.join(dir, 'db.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE session (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    directory TEXT,
    project_id TEXT,
    title TEXT
  );
  CREATE TABLE model_usage (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    turn_id TEXT,
    query_source TEXT,
    status TEXT,
    started_at INTEGER NOT NULL,
    time_to_first_token_ms INTEGER,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
    computed_total_tokens INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE turn_usage (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tool_usage (
    session_id TEXT NOT NULL,
    status TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0
  );
`);

const today = new Date();
today.setHours(12, 0, 0, 0);
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const t = value => value.getTime();

db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('s1', null, 'C:/project', 'p1', 'Parent');
db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('s2', 's1', 'C:/project', 'p1', 'Child');
const insert = db.prepare(`INSERT INTO model_usage
  (session_id, turn_id, query_source, status, started_at, time_to_first_token_ms,
   input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, duration_ms)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
insert.run('s1', 't1', 'main_turn', 'completed', t(today), 1200, 1000, 100, 0, 400, 1100, 1500);
insert.run('s1', 't1', 'main_turn', 'completed', t(today) + 1, 800, 2000, 200, 100, 1200, 2200, 2500);
insert.run('s2', 't2', 'subagent', 'completed', t(today) + 2, 400, 500, 50, 0, 100, 550, 500);
insert.run('s1', 't0', 'main_turn', 'completed', t(yesterday), 600, 900, 90, 0, 300, 990, 700);
db.prepare('INSERT INTO turn_usage VALUES (?, ?, ?)').run('s1', 't1', 4000);
db.prepare('INSERT INTO turn_usage VALUES (?, ?, ?)').run('s1', 't0', 700);
db.prepare('INSERT INTO tool_usage VALUES (?, ?, ?)').run('s1', 'completed', 100);
db.prepare('INSERT INTO tool_usage VALUES (?, ?, ?)').run('s1', 'completed', 200);
db.prepare('INSERT INTO tool_usage VALUES (?, ?, ?)').run('s1', 'error', 300);
db.close();

const reader = usage.openDb(dbPath);
const parent = usage.sessionUsage(reader, 's1');
assert.strictEqual(parent.total, 4290);
assert.strictEqual(parent.input, 3900);
assert.strictEqual(parent.output, 390);
assert.strictEqual(parent.cacheRead, 1900);
assert.strictEqual(parent.cacheWrite, 100);
assert.strictEqual(parent.uncached, 1900);
assert.strictEqual(parent.ttftMs, 867);
assert.strictEqual(parent.ttftSamples, 3);
assert.deepStrictEqual(parent.context, { used: 2000, window: null, ratio: null });
const parentWithWindow = usage.sessionUsage(reader, 's1', 10000);
assert.deepStrictEqual(parentWithWindow.context, { used: 2000, window: 10000, ratio: 0.2 });

const day = usage.todayUsage(reader, today);
assert.strictEqual(day.total, 3850);
assert.strictEqual(day.requests, 3);
assert.strictEqual(day.ttftMs, 800);

const project = usage.projectUsage(reader, 'C:/project');
assert.strictEqual(project.total, 4840);
assert.strictEqual(project.requests, 4);
assert.deepStrictEqual(usage.sessionActivity(reader, 's1'), {
  turns: 2,
  steps: 3,
  modelMs: 4700,
  toolMs: 600,
  toolCalls: 3,
  toolErrors: 1,
});

const todayRange = usage.localDayRange(today);
assert.strictEqual(todayRange.end - todayRange.start, 24 * 60 * 60 * 1000);

reader.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('sqlite usage tests passed');
