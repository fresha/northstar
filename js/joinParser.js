/**
 * Join Parser - Extract and process HASH_JOIN operators from query profiles
 */

import { parseNumericValue, formatBytes, formatTime } from './utils.js';

/**
 * Recursively find all HASH_JOIN operators (probe and build sides) in the execution data
 */
export function findHashJoins(obj, path = '', context = {}) {
  const probes = [];
  const builds = [];

  // Iterate through all keys in the object
  for (const key in obj) {
    const value = obj[key];

    // Track context: extract fragment_id and pipeline_id from keys as we traverse
    let newContext = { ...context };

    // Check if this key is a Fragment (e.g., "Fragment 0", "Fragment 1")
    const fragmentMatch = key.match(/^Fragment (\d+)$/);
    if (fragmentMatch) {
      newContext.fragmentId = fragmentMatch[1];
    }

    // Check if this key is a Pipeline (e.g., "Pipeline (id=3)")
    const pipelineMatch = key.match(/^Pipeline \(id=(\d+)\)$/);
    if (pipelineMatch) {
      newContext.pipelineId = pipelineMatch[1];
    }

    // Check if this key is a HASH_JOIN_PROBE operator (including SPILLABLE variant)
    if (key.includes('HASH_JOIN_PROBE')) {
      const match = key.match(/plan_node_id=(\d+)/);
      const planNodeId = match ? match[1] : 'unknown';

      probes.push({
        planNodeId: planNodeId,
        operatorName: key,
        pipelineId: newContext.pipelineId || 'unknown',
        fragmentId: newContext.fragmentId || 'unknown',
        path: path + ' > ' + key,
        commonMetrics: value.CommonMetrics || {},
        uniqueMetrics: value.UniqueMetrics || {}
      });
    }

    // Check if this key is a HASH_JOIN_BUILD operator (including SPILLABLE variant)
    if (key.includes('HASH_JOIN_BUILD')) {
      const match = key.match(/plan_node_id=(\d+)/);
      const planNodeId = match ? match[1] : 'unknown';

      builds.push({
        planNodeId: planNodeId,
        operatorName: key,
        pipelineId: newContext.pipelineId || 'unknown',
        fragmentId: newContext.fragmentId || 'unknown',
        path: path + ' > ' + key,
        commonMetrics: value.CommonMetrics || {},
        uniqueMetrics: value.UniqueMetrics || {}
      });
    }

    // If the value is an object, search recursively
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findHashJoins(value, path ? `${path} > ${key}` : key, newContext);
      probes.push(...nested.probes);
      builds.push(...nested.builds);
    }
  }

  return { probes, builds };
}

/**
 * Combine probe and build sides by plan_node_id into unified join records
 */
export function combineJoinOperators(probes, builds) {
  const joinMap = new Map();

  // First, add all probes
  for (const probe of probes) {
    if (!joinMap.has(probe.planNodeId)) {
      joinMap.set(probe.planNodeId, {
        planNodeId: probe.planNodeId,
        fragmentId: probe.fragmentId,
        probe: null,
        build: null
      });
    }
    joinMap.get(probe.planNodeId).probe = probe;
  }

  // Then, add all builds
  for (const build of builds) {
    if (!joinMap.has(build.planNodeId)) {
      joinMap.set(build.planNodeId, {
        planNodeId: build.planNodeId,
        fragmentId: build.fragmentId,
        probe: null,
        build: null
      });
    }
    joinMap.get(build.planNodeId).build = build;
  }

  // Convert to array and sort by planNodeId
  return Array.from(joinMap.values())
    .sort((a, b) => parseInt(a.planNodeId) - parseInt(b.planNodeId));
}

/**
 * Extract join metrics for display in the table
 */
export function extractJoinMetrics(join) {
  const probe = join.probe || {};
  const build = join.build || {};
  const probeCommon = probe.commonMetrics || {};
  const probeUnique = probe.uniqueMetrics || {};
  const buildCommon = build.commonMetrics || {};
  const buildUnique = build.uniqueMetrics || {};

  return {
    // Summary section (from probe and build)
    planNodeId: join.planNodeId,
    joinType: probeUnique.JoinType || buildUnique.JoinType || '-',
    distributionMode: probeUnique.DistributionMode || buildUnique.DistributionMode || '-',
    joinPredicates: buildUnique.JoinPredicates || probeUnique.JoinPredicates || '-',

    // Probe side metrics
    probe: {
      pushRowNum: probeCommon.PushRowNum || '-',
      pullRowNum: probeCommon.PullRowNum || '-',
      operatorTotalTime: probeCommon.OperatorTotalTime || '-',
      searchHashTableTime: probeUnique.SearchHashTableTime || '-',
      probeConjunctEvaluateTime: probeUnique.ProbeConjunctEvaluateTime || '-',
      outputChunkBytes: probeCommon.OutputChunkBytes || '-'
    },

    // Build side metrics
    build: {
      pushRowNum: buildCommon.PushRowNum || '-',
      hashTableMemoryUsage: buildUnique.HashTableMemoryUsage || '-',
      peakRevocableMemoryBytes: buildUnique.PeakRevocableMemoryBytes || '-',
      operatorTotalTime: buildCommon.OperatorTotalTime || '-',
      buildHashTableTime: buildUnique.BuildHashTableTime || '-',
      copyRightTableChunkTime: buildUnique.CopyRightTableChunkTime || '-',
      rowsSpilled: buildUnique.RowsSpilled || '-'
    }
  };
}

/**
 * Process query profile and extract all join information
 */
export function processJoinProfile(json) {
  const query = json.Query;
  if (!query) {
    throw new Error('Invalid query profile format: missing "Query" object');
  }

  const summary = query.Summary || {};
  const execution = query.Execution || {};

  // Find all HASH_JOIN operators
  const { probes, builds } = findHashJoins(execution);

  // Combine probe and build sides
  const joins = combineJoinOperators(probes, builds);

  // Extract metrics for each join
  const joinMetrics = joins.map(extractJoinMetrics);

  console.log(`Found ${joins.length} HASH_JOIN operators`);
  console.log('Join data:', joinMetrics);

  return { summary, execution, joins: joinMetrics };
}

/**
 * Calculate aggregate statistics for join cards
 */
export function calculateJoinStats(joins) {
  if (joins.length === 0) {
    return {
      totalJoins: 0,
      totalHashTableMemory: '-',
      totalBuildTime: '-',
      totalProbeTime: '-',
      maxHashTableMemory: '-',
      totalRowsSpilled: 0
    };
  }

  let totalHashTableMemoryBytes = 0;
  let totalBuildTimeSeconds = 0;
  let totalProbeTimeSeconds = 0;
  let maxHashTableMemoryBytes = 0;
  let totalRowsSpilled = 0;

  for (const join of joins) {
    // Parse hash table memory (parseNumericValue returns bytes)
    const memStr = join.build.hashTableMemoryUsage;
    if (memStr && memStr !== '-') {
      const bytes = parseNumericValue(memStr);
      totalHashTableMemoryBytes += bytes;
      if (bytes > maxHashTableMemoryBytes) {
        maxHashTableMemoryBytes = bytes;
      }
    }

    // Parse build time (parseNumericValue returns seconds)
    const buildTimeStr = join.build.operatorTotalTime;
    if (buildTimeStr && buildTimeStr !== '-') {
      totalBuildTimeSeconds += parseNumericValue(buildTimeStr);
    }

    // Parse probe time (parseNumericValue returns seconds)
    const probeTimeStr = join.probe.operatorTotalTime;
    if (probeTimeStr && probeTimeStr !== '-') {
      totalProbeTimeSeconds += parseNumericValue(probeTimeStr);
    }

    // Parse rows spilled
    const spilledStr = join.build.rowsSpilled;
    if (spilledStr && spilledStr !== '-') {
      totalRowsSpilled += parseNumericValue(spilledStr);
    }
  }

  return {
    totalJoins: joins.length,
    totalHashTableMemory: formatBytes(totalHashTableMemoryBytes),
    totalBuildTime: formatTime(totalBuildTimeSeconds),
    totalProbeTime: formatTime(totalProbeTimeSeconds),
    maxHashTableMemory: formatBytes(maxHashTableMemoryBytes),
    totalRowsSpilled: totalRowsSpilled
  };
}
