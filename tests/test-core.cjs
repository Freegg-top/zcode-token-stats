'use strict';

const assert = require('assert');
const vm = require('vm');
const core = require('../stats-core.js');

for (const [value, expected] of [
  [0, '0'], [999, '999'], [1500, '1.5K'], [12200, '12.2K'],
  [558000, '558K'], [2500000, '2.5M'], [12345678, '12.3M'],
]) assert.strictEqual(core.formatTokens(value), expected);

for (const [value, expected] of [[0, '0'], [9.95, '10'], [9.94, '9.9'], [10, '10'], [42.6, '43']]) {
  assert.strictEqual(core.formatTokensPerSecond(value), expected);
}

assert.strictEqual(core.formatCacheHitPercent(0, 0), null);
assert.strictEqual(core.formatCacheHitPercent(50, 100), '50');
assert.strictEqual(core.formatCacheHitPercent(100, 100), '100');
assert.strictEqual(core.formatCacheHitPercent(999, 1000), '99.9');
assert.strictEqual(core.formatExactTokens(25812345), '25,812,345');
assert.strictEqual(core.formatDuration(45200), '45.2s');
assert.strictEqual(core.formatDuration(162000), '2m42s');

const activity = core.summarizeActivity({ rows: { window: [
  { kind: 'turnHeader', turnId: 'turn-1', modelDurationMs: 1200, toolDurationMs: 400 },
  { kind: 'assistantText', turnId: 'turn-1' },
  { kind: 'turnHeader', turnId: 'turn-2', modelDurationMs: 1800, toolDurationMs: 600 },
] } }, [
  { eventKey: 'a', usage: { outputTokens: 100 }, generationDurationMs: 1000 },
  { eventKey: 'b', usage: { outputTokens: 200 }, generationDurationMs: 2000 },
]);
assert.deepStrictEqual(activity, { turns: 2, steps: 2, modelMs: 3000, toolMs: 1000 });

const usage = core.summarizeUsage([
  { usage: { inputTokens: 95, outputTokens: 10, cachedInputTokens: 50, cachedWriteInputTokens: 5, totalTokens: 0 } },
  { usage: { inputTokens: 20, outputTokens: 5 } },
]);
assert.deepStrictEqual(usage, { uncached: 60, cacheRead: 50, cacheWrite: 5, output: 15, prompt: 115, total: 130 });

const parentUsage = { uncached: 10, cacheRead: 20, cacheWrite: 2, output: 3, prompt: 32, total: 35 };
const childUsage = { uncached: 4, cacheRead: 8, cacheWrite: 1, output: 2, prompt: 13, total: 15 };
assert.deepStrictEqual(core.addUsage(parentUsage, childUsage), {
  uncached: 14, cacheRead: 28, cacheWrite: 3, output: 5, prompt: 45, total: 50,
});
assert.deepStrictEqual(core.sumUsages([parentUsage, childUsage]), core.addUsage(parentUsage, childUsage));

const cumulative = core.sessionUsage({ usage: { cumulative: {
  inputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 10,
} } }, []);
assert.deepStrictEqual(cumulative, {
  uncached: 60, cacheRead: 30, cacheWrite: 10, output: 20, prompt: 100, total: 120, complete: true,
});

const zcodeDatabaseUsage = core.usageBuckets({
  inputTokens: 667721, outputTokens: 303, cacheReadTokens: 667456, cacheWriteTokens: 0,
});
assert.deepStrictEqual(zcodeDatabaseUsage, {
  uncached: 265, cacheRead: 667456, cacheWrite: 0, output: 303, prompt: 667721, total: 668024,
});

const runtime = core.createRuntime();
const embedded = vm.runInNewContext(`${runtime};({ZTF,ZTK,ZTX,ZTB,ZTA})`, {});
assert.strictEqual(embedded.ZTF(9.94), '9.9');
assert.strictEqual(embedded.ZTK(1500), '1.5K');
assert.strictEqual(embedded.ZTX({ rows: { window: [] } }, [
  { usage: { outputTokens: 1 }, generationDurationMs: 1000 },
]).steps, 1);
assert.strictEqual(embedded.ZTB({
  inputTokens: 1000, outputTokens: 50, cacheCreationTokens: 20, cacheReadTokens: 700,
}).total, 1050);
assert.strictEqual(embedded.ZTA(parentUsage, childUsage).total, 50);

console.log('core tests passed');
