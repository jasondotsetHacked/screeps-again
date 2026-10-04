const finite = value => typeof value === 'number' && Number.isFinite(value);

export function summarize(values) {
  const known = values.filter(finite);
  if (!known.length) return { observations: 0, min: null, max: null, average: null, first: null, last: null, direction: 'unknown' };
  const first = known[0], last = known.at(-1);
  return { observations: known.length, min: Math.min(...known), max: Math.max(...known),
    average: known.reduce((sum, value) => sum + value, 0) / known.length, first, last,
    direction: known.length < 2 ? 'unknown' : last > first ? 'up' : last < first ? 'down' : 'flat' };
}

function occurrences(values) {
  let count = 0, observed = 0, run = 0, longestRun = 0;
  for (const value of values) {
    if (value !== null) observed += 1;
    if (value === true) { count += 1; run += 1; longestRun = Math.max(longestRun, run); }
    else run = 0;
  }
  return { samples: count, observedSamples: observed, percent: observed ? 100 * count / observed : null, longestRun };
}

function changes(entries, select) {
  const result = [];
  for (let i = 1; i < entries.length; i += 1) {
    const previous = select(entries[i - 1].room), current = select(entries[i].room);
    if (finite(previous) && finite(current) && previous !== current) {
      result.push({ collectedAt: entries[i].sample.collectedAt, tick: entries[i].sample.tick, from: previous, to: current });
    }
  }
  return result;
}

function controllerTrend(entries) {
  let delta = 0, milliseconds = 0, comparablePairs = 0, excludedPairs = 0;
  let flatRun = 0, longestFlatSamples = 0, resumedAfterFlat = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const previous = entries[i - 1], current = entries[i];
    const elapsed = Date.parse(current.sample.collectedAt) - Date.parse(previous.sample.collectedAt);
    if (current.sample.tick <= previous.sample.tick || current.room.rcl !== previous.room.rcl ||
        !finite(current.room.progress) || !finite(previous.room.progress) ||
        current.room.progress < previous.room.progress || elapsed <= 0) {
      excludedPairs += 1; flatRun = 0; continue;
    }
    const pairDelta = current.room.progress - previous.room.progress;
    delta += pairDelta; milliseconds += elapsed; comparablePairs += 1;
    if (pairDelta === 0) {
      flatRun += 1; longestFlatSamples = Math.max(longestFlatSamples, flatRun + 1);
    } else {
      if (flatRun > 0) resumedAfterFlat += 1;
      flatRun = 0;
    }
  }
  return { sameRclProgressDelta: comparablePairs ? delta : null, comparablePairs, excludedPairs,
    comparableHours: milliseconds / 3600000, progressPerHour: milliseconds ? delta * 3600000 / milliseconds : null,
    longestFlatSamples, resumedAfterFlat };
}

export function diagnose(samples) {
  const first = samples[0], last = samples.at(-1);
  const timestamps = samples.map(sample => Date.parse(sample.collectedAt));
  const gaps = timestamps.slice(1).map((time, index) => (time - timestamps[index]) / 60000);
  const facts = {
    sampleCount: samples.length,
    start: first?.collectedAt ?? null, end: last?.collectedAt ?? null,
    firstTick: first?.tick ?? null, lastTick: last?.tick ?? null,
    tickResetObservations: samples.slice(1).filter((sample, index) => sample.tick < samples[index].tick).length,
    repeatedTickPairs: samples.slice(1).filter((sample, index) => sample.tick === samples[index].tick).length,
    maxSampleGapMinutes: gaps.length ? Math.max(...gaps) : null,
    runtimeErrors: [], runtimeErrorsTruncated: false, rooms: []
  };
  const uniqueErrors = new Map();
  for (const sample of samples) for (const error of sample.telemetry.recentErrors) {
    const key = JSON.stringify([error.tick, error.scope, error.subject, error.message]);
    if (!uniqueErrors.has(key)) uniqueErrors.set(key, { ...error, firstObservedAt: sample.collectedAt });
  }
  facts.runtimeErrors = [...uniqueErrors.values()].slice(0, 50);
  facts.runtimeErrorsTruncated = uniqueErrors.size > 50;
  facts.uniqueRuntimeErrors = uniqueErrors.size;
  const trends = { cpuUsed: summarize(samples.map(sample => sample.telemetry.cpu.used)),
    bucket: summarize(samples.map(sample => sample.telemetry.cpu.bucket)), rooms: [] };
  const signals = [];
  const roomNames = [...new Set(samples.flatMap(sample => sample.telemetry.room ?
    [sample.telemetry.room.name] : sample.telemetry.rooms.map(room => room.name)))].sort();
  for (const name of roomNames) {
    // Missing room observations break persistence and progress comparisons.
    const all = samples.map(sample => ({ sample, room: sample.telemetry.room ?? sample.telemetry.rooms.find(room => room.name === name) }))
      .map(entry => entry.room?.name === name ? entry : { sample: entry.sample, room: null });
    const entries = all.filter(entry => entry.room);
    const roomFacts = { name, sampleCount: entries.length,
      rclTransitions: changes(all, room => room?.rcl),
      constructionChanges: changes(all, room => room?.constructionSites),
      infrastructureChanges: Object.fromEntries(['extensions', 'containers', 'towers', 'roads'].map(kind => [kind,
        { built: changes(all, room => room?.infrastructure[kind]?.built), sites: changes(all, room => room?.infrastructure[kind]?.sites) }])),
      workerDeficit: occurrences(all.map(({ room }) => finite(room?.workerPopulation?.effective) && finite(room?.workerPopulation?.target)
        ? room.workerPopulation.effective < room.workerPopulation.target : null)),
      spawnActive: occurrences(all.map(({ room }) => room ? room.spawns.some(spawn => spawn.spawning !== null) : null)),
      laborEmergency: occurrences(all.map(({ room }) => room?.labor?.emergency ?? null)),
      hostiles: occurrences(all.map(({ room }) => finite(room?.hostiles) ? room.hostiles > 0 : null)),
      safety: Object.fromEntries(['requested', 'attempted', 'accepted'].map(key => [key,
        occurrences(all.map(({ room }) => room?.safety?.[key] ?? null))])), labor: []
    };
    const laborKinds = [...new Set(entries.flatMap(({ room }) => room.labor?.kinds.map(kind => kind.kind).filter(Boolean) ?? []))].sort();
    for (const kind of laborKinds) {
      const values = all.map(({ room }) => room?.labor?.kinds.find(value => value.kind === kind));
      const labor = { kind,
        unmetMinimum: occurrences(values.map(value => finite(value?.unsatisfiedMinimum) ? value.unsatisfiedMinimum > 0 : null)),
        unsatisfiedDesired: occurrences(values.map(value => finite(value?.unsatisfied) ? value.unsatisfied > 0 : null)),
        workerActivity: Object.fromEntries(['acquiringWorkers', 'travelingWorkers', 'workingWorkers', 'blockedWorkers'].map(key =>
          [key, summarize(values.map(value => value?.[key]))])) };
      roomFacts.labor.push(labor);
      if (labor.unmetMinimum.samples) signals.push({ code: 'UNMET_MINIMUM', room: name, kind, ...labor.unmetMinimum });
      if (labor.unsatisfiedDesired.longestRun >= 3) signals.push({ code: 'PERSISTENT_UNSATISFIED_WORK', room: name, kind, ...labor.unsatisfiedDesired });
    }
    const progressEntries = all.map(entry => entry.room ? entry : { ...entry, room: { rcl: null, progress: null } });
    const controller = controllerTrend(progressEntries);
    facts.rooms.push(roomFacts);
    trends.rooms.push({ name, controller, ticksToDowngrade: summarize(all.map(({ room }) => room?.ticksToDowngrade)),
      energyAvailable: summarize(all.map(({ room }) => room?.energyAvailable)),
      energyCapacityAvailable: summarize(all.map(({ room }) => room?.energyCapacityAvailable)),
      hostileCount: summarize(all.map(({ room }) => room?.hostiles)) });
    if (roomFacts.workerDeficit.samples) signals.push({ code: 'WORKER_DEFICIT', room: name, ...roomFacts.workerDeficit });
    if (roomFacts.laborEmergency.samples) signals.push({ code: 'LABOR_EMERGENCY', room: name, ...roomFacts.laborEmergency });
    if (roomFacts.hostiles.samples) signals.push({ code: 'HOSTILES_OBSERVED', room: name, ...roomFacts.hostiles });
    if (controller.longestFlatSamples >= 4) signals.push({ code: 'FLAT_CONTROLLER_PROGRESS', room: name, samples: controller.longestFlatSamples });
  }
  if (uniqueErrors.size) signals.push({ code: 'RUNTIME_ERRORS_OBSERVED', uniqueErrors: uniqueErrors.size });
  return { facts, trends, signals,
    interpretation: 'These are sampled observations, not causal conclusions. Events between samples may be missed. Safety acceptance does not prove protection. Progress rates exclude RCL changes, resets, repeated ticks and missing observations.' };
}
