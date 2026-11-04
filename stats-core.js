'use strict';

/** Return a finite, non-negative numeric counter, or zero for absent usage. */
function counter(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Match Harness's throughput formatting: integer from 10, one decimal below. */
function formatTokensPerSecond(value) {
  const clamped = Math.max(0, value);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

/** Match Harness's compact token formatting (517 / 12.2K / 517K / 1.2M). */
function formatTokens(value) {
  const scaled = candidate => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10);
  if (value < 1000) return String(value);
  if (value < 1000000) return `${scaled(value / 1000)}K`;
  return `${scaled(value / 1000000)}M`;
}

/** Round a cache-hit ratio without displaying a partial hit as 100 percent. */
function formatCacheHitPercent(cacheRead, prompt, decimalPlaces = 0) {
  if (prompt === 0) return null;
  const scale = 10 ** decimalPlaces;
  if (cacheRead >= prompt) return '100';
  const raw = cacheRead / prompt * 100 * scale;
  const rounded = Math.round(raw);
  if (rounded < 100 * scale) return String(rounded / scale);
  let precision = decimalPlaces + 1;
  let text;
  do {
    text = (Math.floor(cacheRead / prompt * 100 * 10 ** precision) / 10 ** precision).toFixed(precision);
    precision += 1;
  } while (Number(text) >= 100 && precision <= 16);
  return text;
}

/** Exact token count with stable comma grouping for detail rows. */
function formatExactTokens(value) {
  return Math.trunc(counter(value)).toLocaleString('en-US');
}

/** Harness-style compact duration: 45.2s, then 2m42s. */
function formatDuration(ms) {
  const seconds = counter(ms) / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/**
 * Fold the loaded turn headers for counts and model/tool wall time. Rounds are
 * observed model settlements, so their count is the observed step count.
 */
function summarizeActivity(snapshot, rounds) {
  const rows = snapshot?.rows?.window;
  const headers = Array.isArray(rows) ? rows.filter(row => row?.kind === 'turnHeader') : [];
  const timed = Array.isArray(rounds) ? rounds : [];
  const turnIds = new Set(headers.map(row => row.turnId).filter(id => id !== undefined && id !== null));
  const steps = timed.length;
  let modelMs = 0;
  let toolMs = 0;
  let hasModel = false;
  let hasTool = false;
  for (const header of headers) {
    const model = header.modelDurationMs;
    const tool = header.toolDurationMs;
    if (typeof model === 'number' && Number.isFinite(model) && model > 0) {
      modelMs += model;
      hasModel = true;
    }
    if (typeof tool === 'number' && Number.isFinite(tool) && tool > 0) {
      toolMs += tool;
      hasTool = true;
    }
  }
  if (!hasModel) {
    const measured = summarizeSpeed(timed);
    if (measured !== null) {
      modelMs = measured.ms;
      hasModel = true;
    }
  }
  return {
    turns: turnIds.size || (steps > 0 ? 1 : 0),
    steps,
    modelMs: hasModel ? modelMs : null,
    toolMs: hasTool ? toolMs : null,
  };
}

/** Merge newly observed bounded debug rounds without double-counting event ids. */
function mergeRounds(previous, incoming, limit = 2000) {
  const merged = new Map();
  for (const round of [...previous, ...incoming]) {
    if (round && typeof round.eventKey === 'string') merged.set(round.eventKey, round);
  }
  return [...merged.values()].slice(-limit);
}

/**
 * Fold only requests with provider output counts and measured response time.
 * A zero-duration response does not create an artificial infinite speed.
 */
function summarizeSpeed(rounds) {
  let tokens = 0;
  let ms = 0;
  let timedRequests = 0;
  for (const round of Array.isArray(rounds) ? rounds : []) {
    const output = round?.usage?.outputTokens;
    const duration = round?.generationDurationMs;
    if (typeof output !== 'number' || !Number.isFinite(output) || output < 0
      || typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) continue;
    tokens += output;
    ms += duration;
    timedRequests += 1;
  }
  return ms > 0 ? { tokens, ms, timedRequests, value: tokens * 1000 / ms } : null;
}

/** Normalize either ZCode or Harness token field names to disjoint buckets. */
function usageBuckets(usage = {}) {
  const cacheRead = counter(usage.cacheReadTokens ?? usage.cachedInputTokens);
  const cacheWrite = counter(usage.cacheCreationTokens ?? usage.cacheWriteTokens ?? usage.cachedWriteInputTokens);
  // ZCode's inputTokens is the total prompt-side input, including cache traffic.
  // Harness supplies disjoint uncached/read/write buckets instead.
  const explicitUncached = typeof usage.uncachedInputTokens === 'number';
  const prompt = explicitUncached
    ? counter(usage.uncachedInputTokens) + cacheRead + cacheWrite
    : counter(usage.inputTokens) || cacheRead + cacheWrite;
  const uncached = explicitUncached
    ? counter(usage.uncachedInputTokens)
    : Math.max(0, prompt - cacheRead - cacheWrite);
  const output = counter(usage.outputTokens);
  return { uncached, cacheRead, cacheWrite, output, prompt, total: prompt + output };
}

/** Aggregate disjoint usage buckets, ignoring provider-supplied inconsistent totals. */
function summarizeUsage(rounds) {
  const total = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, prompt: 0, total: 0 };
  for (const round of Array.isArray(rounds) ? rounds : []) {
    const usage = usageBuckets(round?.usage);
    for (const key of Object.keys(total)) total[key] += usage[key];
  }
  return total;
}

/** Add two disjoint usage summaries, preserving the base session's fields. */
function addUsage(left, right) {
  const total = { ...left };
  for (const key of ['uncached', 'cacheRead', 'cacheWrite', 'output', 'prompt', 'total']) {
    total[key] = (left?.[key] ?? 0) + (right?.[key] ?? 0);
  }
  return total;
}

/** Fold child-session usage summaries into one aggregate. */
function sumUsages(values) {
  let total = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, prompt: 0, total: 0 };
  for (const usage of Array.isArray(values) ? values : []) total = addUsage(total, usage);
  return total;
}

/** Read the cumulative usage object carried by ZCode's composer snapshot. */
function cumulativeUsage(snapshot) {
  return snapshot?.usage?.cumulative ?? snapshot?.cumulative ?? null;
}

/** Prefer complete session usage; use observed rounds only before it arrives. */
function sessionUsage(snapshot, rounds) {
  const cumulative = cumulativeUsage(snapshot);
  return {
    ...usageBuckets(cumulative ?? summarizeUsage(rounds)),
    complete: cumulative !== null,
  };
}

/** Serialize pure statistics into the version-locked renderer patch. */
const runtimeFunctions = {
  counter: ['ZTN', counter],
  formatTokensPerSecond: ['ZTF', formatTokensPerSecond],
  formatTokens: ['ZTK', formatTokens],
  formatCacheHitPercent: ['ZTH', formatCacheHitPercent],
  formatExactTokens: ['ZTE', formatExactTokens],
  formatDuration: ['ZTD', formatDuration],
  mergeRounds: ['ZTM', mergeRounds],
  summarizeSpeed: ['ZTS', summarizeSpeed],
  summarizeActivity: ['ZTX', summarizeActivity],
  usageBuckets: ['ZTB', usageBuckets],
  summarizeUsage: ['ZTU', summarizeUsage],
  addUsage: ['ZTA', addUsage],
  sumUsages: ['ZTJ', sumUsages],
  cumulativeUsage: ['ZTC', cumulativeUsage],
  sessionUsage: ['ZTR', sessionUsage],
};

function createRuntime() {
  const names = Object.fromEntries(Object.entries(runtimeFunctions).map(([name, [alias]]) => [name, alias]));
  let runtime = Object.entries(runtimeFunctions).map(([original, [alias, fn]]) => (
    fn.toString().replace(new RegExp(`\\b${original}(?=\\()`), alias)
  )).join('\n');
  for (const [original, alias] of Object.entries(names)) {
    runtime = runtime.replace(new RegExp(`(?<![\\w$])${original}(?=\\()`, 'g'), alias);
  }
  return runtime;
}

module.exports = {
  counter,
  formatTokensPerSecond,
  formatTokens,
  formatCacheHitPercent,
  formatExactTokens,
  formatDuration,
  mergeRounds,
  summarizeSpeed,
  summarizeActivity,
  usageBuckets,
  summarizeUsage,
  addUsage,
  sumUsages,
  cumulativeUsage,
  sessionUsage,
  createRuntime,
};
