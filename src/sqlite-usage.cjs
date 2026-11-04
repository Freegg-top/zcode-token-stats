'use strict';

/**
 * Read-only ZCode usage projection.
 *
 * Inputs are the local ZCode SQLite database. `model_usage.input_tokens`
 * already includes cache reads/writes, so `total = input + output`; cache
 * fields are exposed separately and must not be added again.
 */

const { DatabaseSync } = require('node:sqlite');

function integer(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function bucket(row) {
  const input = integer(row.input_tokens);
  const output = integer(row.output_tokens);
  const cacheRead = integer(row.cache_read_input_tokens);
  const cacheWrite = integer(row.cache_creation_input_tokens);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    uncached: Math.max(0, input - cacheRead - cacheWrite),
    total: input + output,
  };
}

function emptySummary() {
  return {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    uncached: 0,
    total: 0,
    ttftMs: null,
    ttftSamples: 0,
  };
}

function summarize(rows) {
  const result = emptySummary();
  let ttftSum = 0;
  let ttftSamples = 0;
  for (const row of rows) {
    const value = bucket(row);
    result.requests += 1;
    result.input += value.input;
    result.output += value.output;
    result.cacheRead += value.cacheRead;
    result.cacheWrite += value.cacheWrite;
    result.uncached += value.uncached;
    result.total += value.total;
    const ttft = integer(row.time_to_first_token_ms);
    if (ttft > 0) {
      ttftSum += ttft;
      ttftSamples += 1;
    }
  }
  result.ttftSamples = ttftSamples;
  result.ttftMs = ttftSamples > 0 ? Math.round(ttftSum / ttftSamples) : null;
  return result;
}

function openDb(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function readSession(db, sessionId) {
  return db.prepare(`
    SELECT id, parent_id, directory, project_id, title
    FROM session WHERE id = ?
  `).get(sessionId) ?? null;
}

function modelRows(db, where, params) {
  return db.prepare(`
    SELECT session_id, turn_id, query_source, status, started_at,
           time_to_first_token_ms, input_tokens, output_tokens,
           reasoning_tokens, cache_creation_input_tokens,
           cache_read_input_tokens, computed_total_tokens
    FROM model_usage
    WHERE ${where}
    ORDER BY started_at ASC, id ASC
  `).all(...params);
}

function sessionUsage(db, sessionId, contextWindow = null) {
  const session = readSession(db, sessionId);
  const rows = modelRows(db, 'session_id = ?', [sessionId]);
  return {
    session,
    ...summarize(rows),
    context: contextFromRows(rows, contextWindow),
  };
}

function contextFromRows(rows, window = null) {
  const last = rows.at(-1);
  if (!last) return { used: 0, window: null, ratio: null };
  const used = integer(last.input_tokens);
  const size = integer(window);
  return { used, window: size > 0 ? size : null, ratio: size > 0 ? used / size : null };
}

function sessionActivity(db, sessionId) {
  const turns = db.prepare('SELECT COUNT(*) AS count FROM turn_usage WHERE session_id = ?').get(sessionId);
  const tools = db.prepare(`
    SELECT COUNT(*) AS count,
           COALESCE(SUM(duration_ms), 0) AS durationMs,
           COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors
    FROM tool_usage WHERE session_id = ?
  `).get(sessionId);
  const models = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(duration_ms), 0) AS durationMs
    FROM model_usage WHERE session_id = ?
  `).get(sessionId);
  return {
    turns: integer(turns?.count),
    steps: integer(models?.count),
    modelMs: integer(models?.durationMs),
    toolMs: integer(tools?.durationMs),
    toolCalls: integer(tools?.count),
    toolErrors: integer(tools?.errors),
  };
}

function localDayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}

function todayUsage(db, now = new Date()) {
  const range = localDayRange(now);
  return summarize(modelRows(db, 'started_at >= ? AND started_at < ?', [range.start, range.end]));
}

function projectUsage(db, directory) {
  const rows = db.prepare(`
    SELECT mu.session_id, mu.turn_id, mu.query_source, mu.status, mu.started_at,
           mu.time_to_first_token_ms, mu.input_tokens, mu.output_tokens,
           mu.reasoning_tokens, mu.cache_creation_input_tokens,
           mu.cache_read_input_tokens, mu.computed_total_tokens
    FROM model_usage mu
    JOIN session s ON s.id = mu.session_id
    WHERE s.directory = ?
    ORDER BY mu.started_at ASC, mu.id ASC
  `).all(directory);
  return summarize(rows);
}

function usageSnapshot(db, sessionId, now = new Date(), contextWindow = null) {
  const session = sessionUsage(db, sessionId, contextWindow);
  return {
    session: session.session,
    sessionUsage: session,
    activity: sessionActivity(db, sessionId),
    today: todayUsage(db, now),
    project: session.session?.directory ? projectUsage(db, session.session.directory) : null,
  };
}

module.exports = {
  openDb,
  summarize,
  sessionUsage,
  sessionActivity,
  todayUsage,
  projectUsage,
  usageSnapshot,
  localDayRange,
  bucket,
};
