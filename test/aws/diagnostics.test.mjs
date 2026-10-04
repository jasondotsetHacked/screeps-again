import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnose } from '../../aws/query/diagnostics.mjs';
import { samples, ROOM } from './queryFixtures.mjs';

test('diagnostics report sample coverage and first/last ticks', () => {
  const result = diagnose(samples());
  assert.equal(result.facts.sampleCount, 4); assert.equal(result.facts.firstTick, 100); assert.equal(result.facts.lastTick, 103);
  assert.equal(result.facts.maxSampleGapMinutes, 15);
});

test('RCL transitions are observed facts and progress rates exclude the reset', () => {
  const result = diagnose(samples(4, (item, index) => {
    if (index >= 2) { item.telemetry.rooms[0].rcl = 3; item.telemetry.rooms[0].progress = (index - 2) * 20; }
  }));
  const transition = result.facts.rooms[0].rclTransitions[0];
  assert.equal(transition.from, 2); assert.equal(transition.to, 3);
  const controller = result.trends.rooms[0].controller;
  assert.equal(controller.sameRclProgressDelta, 30); assert.equal(controller.excludedPairs, 1);
  assert.equal(controller.progressPerHour, 60);
});

test('same-RCL progress delta and elapsed-hour rate reflect observed gains', () => {
  const controller = diagnose(samples()).trends.rooms[0].controller;
  assert.equal(controller.sameRclProgressDelta, 30); assert.equal(controller.comparableHours, 0.75);
  assert.equal(controller.progressPerHour, 40);
});

test('negative progress, repeated ticks and respawn tick resets are excluded', () => {
  const series = samples();
  series[1].telemetry.rooms[0].progress = 1;
  series[2].tick = series[1].tick;
  series[3].tick = 1;
  const result = diagnose(series);
  assert.equal(result.trends.rooms[0].controller.comparablePairs, 0);
  assert.equal(result.trends.rooms[0].controller.progressPerHour, null);
  assert.equal(result.facts.tickResetObservations, 1); assert.equal(result.facts.repeatedTickPairs, 1);
});

test('flat progress and subsequent resumption are observed without attribution', () => {
  const result = diagnose(samples(5, (item, index) => { item.telemetry.rooms[0].progress = index === 4 ? 110 : 100; }));
  assert.equal(result.trends.rooms[0].controller.longestFlatSamples, 4);
  assert.equal(result.trends.rooms[0].controller.resumedAfterFlat, 1);
  assert.ok(result.signals.some(signal => signal.code === 'FLAT_CONTROLLER_PROGRESS'));
});

test('worker deficit counts and percentages compare effective population to target', () => {
  const result = diagnose(samples(4, (item, index) => { if (index === 3) item.telemetry.rooms[0].workerPopulation.effective = 5; }));
  assert.equal(result.facts.rooms[0].workerDeficit.samples, 3);
  assert.equal(result.facts.rooms[0].workerDeficit.percent, 75);
  assert.equal(result.facts.rooms[0].workerDeficit.longestRun, 3);
  assert.ok(result.signals.some(signal => signal.code === 'WORKER_DEFICIT' && signal.room === ROOM));
});

test('unknown population data does not count as either healthy or deficient', () => {
  const series = samples(); series[1].telemetry.rooms[0].workerPopulation.effective = null;
  const result = diagnose(series).facts.rooms[0].workerDeficit;
  assert.equal(result.observedSamples, 3); assert.equal(result.percent, 100); assert.equal(result.longestRun, 2);
});

test('labor emergency observations produce a deterministic warning signal', () => {
  const result = diagnose(samples(4, (item, index) => { item.telemetry.rooms[0].labor.emergency = index < 2; }));
  assert.equal(result.facts.rooms[0].laborEmergency.samples, 2);
  assert.ok(result.signals.some(signal => signal.code === 'LABOR_EMERGENCY'));
});

test('unmet minimum is distinct from unsatisfied desired work', () => {
  const result = diagnose(samples(4, (item, index) => { item.telemetry.rooms[0].labor.kinds[0].unsatisfiedMinimum = index === 0 ? 1 : 0; }));
  assert.equal(result.facts.rooms[0].labor[0].unmetMinimum.samples, 1);
  assert.equal(result.facts.rooms[0].labor[0].unsatisfiedDesired.samples, 4);
  assert.ok(result.signals.some(signal => signal.code === 'UNMET_MINIMUM'));
});

test('persistent unsatisfied work requires three consecutive known samples', () => {
  const persistent = diagnose(samples());
  assert.ok(persistent.signals.some(signal => signal.code === 'PERSISTENT_UNSATISFIED_WORK'));
  const interrupted = diagnose(samples(4, (item, index) => { if (index === 1) item.telemetry.rooms[0].labor.kinds[0].unsatisfied = 0; }));
  assert.ok(!interrupted.signals.some(signal => signal.code === 'PERSISTENT_UNSATISFIED_WORK'));
});

test('CPU summaries report minimum maximum average and observations', () => {
  const cpu = diagnose(samples()).trends.cpuUsed;
  assert.equal(cpu.min, 2); assert.equal(cpu.max, 5); assert.equal(cpu.average, 3.5); assert.equal(cpu.observations, 4);
});

test('bucket summaries report range and endpoint direction', () => {
  const bucket = diagnose(samples()).trends.bucket;
  assert.equal(bucket.min, 8700); assert.equal(bucket.max, 9000); assert.equal(bucket.average, 8850); assert.equal(bucket.direction, 'down');
});

test('runtime errors repeated in recentErrors are deduplicated across samples', () => {
  const result = diagnose(samples(4, item => { item.telemetry.recentErrors = [{ tick: 99, scope: 'creep', subject: ROOM, message: 'error' }]; }));
  assert.equal(result.facts.uniqueRuntimeErrors, 1); assert.equal(result.facts.runtimeErrors.length, 1);
  assert.ok(result.signals.some(signal => signal.code === 'RUNTIME_ERRORS_OBSERVED'));
});

test('hostile count observations produce counts and a warning', () => {
  const result = diagnose(samples(4, (item, index) => { item.telemetry.rooms[0].hostiles = index === 2 ? 3 : 0; }));
  assert.equal(result.facts.rooms[0].hostiles.samples, 1); assert.equal(result.trends.rooms[0].hostileCount.max, 3);
  assert.ok(result.signals.some(signal => signal.code === 'HOSTILES_OBSERVED'));
});

test('safety requests attempts and acceptance remain separate sample observations', () => {
  const result = diagnose(samples(4, (item, index) => { item.telemetry.rooms[0].safety = {
    requested: index > 0, attempted: index > 1, accepted: index === 3, reason: 'controller' }; }));
  const safety = result.facts.rooms[0].safety;
  assert.equal(safety.requested.samples, 3); assert.equal(safety.attempted.samples, 2); assert.equal(safety.accepted.samples, 1);
  assert.match(result.interpretation, /does not prove protection/);
});

test('construction infrastructure and spawning changes use existing schema fields', () => {
  const result = diagnose(samples(4, (item, index) => {
    item.telemetry.rooms[0].constructionSites = index < 2 ? 2 : 1;
    item.telemetry.rooms[0].infrastructure.extensions.built = index < 2 ? 5 : 6;
    item.telemetry.rooms[0].spawns[0].spawning = index === 2 ? { name: 'worker', remainingTime: 10 } : null;
  }));
  const room = result.facts.rooms[0];
  assert.equal(room.constructionChanges[0].to, 1); assert.equal(room.infrastructureChanges.extensions.built[0].to, 6);
  assert.equal(room.spawnActive.samples, 1);
});

test('downgrade energy and labor activity summaries remain bounded observations', () => {
  const result = diagnose(samples());
  assert.equal(result.trends.rooms[0].ticksToDowngrade.min, 9700);
  assert.equal(result.trends.rooms[0].ticksToDowngrade.direction, 'down');
  assert.equal(result.trends.rooms[0].energyAvailable.average, 300);
  assert.equal(result.facts.rooms[0].labor[0].workerActivity.workingWorkers.average, 2);
});

test('colony diagnostics summarize each observed room independently', () => {
  const series = samples();
  for (const sample of series) sample.telemetry.rooms.push({ ...structuredClone(sample.telemetry.rooms[0]), name: 'W0N0',
    workerPopulation: { effective: 6, target: 5 } });
  const result = diagnose(series);
  assert.equal(result.facts.rooms.length, 2);
  assert.equal(result.facts.rooms.find(room => room.name === 'W0N0').workerDeficit.samples, 0);
  assert.equal(result.trends.cpuUsed.observations, 4);
});

test('missing room samples break persistence and controller comparisons', () => {
  const series = samples(); series[1].telemetry.rooms = [];
  const result = diagnose(series);
  assert.equal(result.facts.rooms[0].workerDeficit.longestRun, 2);
  assert.equal(result.trends.rooms[0].controller.comparablePairs, 1);
  assert.ok(!result.signals.some(signal => signal.code === 'PERSISTENT_UNSATISFIED_WORK'));
});

test('empty and single-sample windows never fabricate rates or direction', () => {
  assert.equal(diagnose([]).facts.firstTick, null);
  const result = diagnose(samples(1));
  assert.equal(result.trends.rooms[0].controller.progressPerHour, null);
  assert.equal(result.trends.bucket.direction, 'unknown');
});

test('diagnostics are deterministic pure and make no unsupported causal claims', () => {
  const series = samples(), before = structuredClone(series);
  const first = diagnose(series), second = diagnose(series);
  assert.deepEqual(first, second); assert.deepEqual(series, before);
  assert.deepEqual(Object.keys(first).sort(), ['facts', 'interpretation', 'signals', 'trends']);
  for (const forbidden of ['caused', 'because', 'due to', 'responsible for']) assert.ok(!JSON.stringify(first).includes(forbidden));
  assert.match(first.interpretation, /not causal conclusions/);
});
