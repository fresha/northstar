/**
 * Join Parser - Extract and process HASH_JOIN operators from query profiles
 */

import { parseNumericValue, formatBytes, formatTime } from './utils.js';

/**
 * Parse the Topology JSON string and build a node map
 * Returns a Map of nodeId -> { id, name, children, properties }
 */
export function parseTopology(execution) {
  if (!execution.Topology) {
    return null;
  }

  try {
    const topology = JSON.parse(execution.Topology);
    const nodeMap = new Map();

    for (const node of topology.nodes) {
      nodeMap.set(String(node.id), {
        id: String(node.id),
        name: node.name,
        children: (node.children || []).map(String),
        properties: node.properties || {}
      });
    }

    return nodeMap;
  } catch (e) {
    console.error('Failed to parse Topology:', e);
    return null;
  }
}

/**
 * For a HASH_JOIN node, find the EXCHANGE child node (build side input)
 * In topology, HASH_JOIN typically has 2 children: [probe_side, build_side]
 * The build side often comes through an EXCHANGE for broadcast/shuffle joins
 */
export function findBuildSideExchange(joinNodeId, topologyMap) {
  if (!topologyMap) return null;

  const joinNode = topologyMap.get(joinNodeId);
  if (!joinNode || joinNode.name !== 'HASH_JOIN') return null;

  // HASH_JOIN has children [probe_child, build_child]
  // The build side is typically the second child
  if (joinNode.children.length < 2) return null;

  const buildChildId = joinNode.children[1];
  const buildChild = topologyMap.get(buildChildId);

  // Check if build child is an EXCHANGE (for broadcast/shuffle joins)
  if (buildChild && buildChild.name === 'EXCHANGE') {
    return buildChildId;
  }

  // If not directly an EXCHANGE, traverse down to find one
  // (e.g., might be PROJECT -> EXCHANGE)
  let current = buildChild;
  while (current && current.children.length > 0) {
    const childId = current.children[0];
    const child = topologyMap.get(childId);
    if (child && child.name === 'EXCHANGE') {
      return childId;
    }
    current = child;
  }

  return null;
}

/**
 * Get EXCHANGE_SINK PushRowNum for a given plan_node_id
 * This represents the rows BEFORE broadcast/shuffle
 */
export function getExchangeSinkPushRowNum(execution, exchangeNodeId) {
  for (const fragKey of Object.keys(execution)) {
    if (!fragKey.startsWith('Fragment ')) continue;

    const fragment = execution[fragKey];

    for (const pipeKey of Object.keys(fragment)) {
      const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
      if (!pipeMatch) continue;

      const pipeline = fragment[pipeKey];

      for (const opKey of Object.keys(pipeline)) {
        // Look for EXCHANGE_SINK with matching plan_node_id
        if (opKey.includes('EXCHANGE_SINK') && opKey.includes(`plan_node_id=${exchangeNodeId}`)) {
          const opData = pipeline[opKey];
          return opData?.CommonMetrics?.PushRowNum || null;
        }
      }
    }
  }

  return null;
}

/**
 * Sum OperatorTotalTime for all operators with given plan_node_ids
 * Uses the same Fragment > Pipeline > Operator traversal as visualizer.js
 * Returns a Map of planNodeId -> total time in seconds
 */
export function sumOperatorTimesByPlanNodeId(execution, targetPlanNodeIds) {
  const timesByPlanNodeId = new Map();

  // Initialize all target plan node IDs with 0
  for (const id of targetPlanNodeIds) {
    timesByPlanNodeId.set(id, 0);
  }

  // Iterate through Fragments (same as visualizer.js extractMetricsByPlanNodeId)
  for (const fragKey of Object.keys(execution)) {
    if (!fragKey.startsWith('Fragment ')) continue;

    const fragment = execution[fragKey];

    // Iterate through Pipelines
    for (const pipeKey of Object.keys(fragment)) {
      const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
      if (!pipeMatch) continue;

      const pipeline = fragment[pipeKey];

      // Iterate through Operators
      for (const opKey of Object.keys(pipeline)) {
        const opMatch = opKey.match(/(.+) \(plan_node_id=(-?\d+)\)/);
        if (!opMatch) continue;

        const planNodeId = opMatch[2];

        // Add OperatorTotalTime for operators with matching plan_node_id
        if (targetPlanNodeIds.has(planNodeId)) {
          const opData = pipeline[opKey];
          const timeStr = opData?.CommonMetrics?.OperatorTotalTime;
          if (timeStr) {
            const timeSeconds = parseNumericValue(timeStr);
            timesByPlanNodeId.set(
              planNodeId,
              timesByPlanNodeId.get(planNodeId) + timeSeconds
            );
          }
        }
      }
    }
  }

  return timesByPlanNodeId;
}

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
 * @param {Object} join - The join object with probe and build operators
 * @param {number} totalTimeSeconds - Total time from ALL operators with this plan_node_id
 * @param {string|null} buildInputRows - Pre-broadcast/shuffle row count (from EXCHANGE_SINK)
 */
export function extractJoinMetrics(join, totalTimeSeconds, buildInputRows = null) {
  const probe = join.probe || {};
  const build = join.build || {};
  const probeCommon = probe.commonMetrics || {};
  const probeUnique = probe.uniqueMetrics || {};
  const buildCommon = build.commonMetrics || {};
  const buildUnique = build.uniqueMetrics || {};

  // Parse operator times for probe and build
  const probeTimeStr = probeCommon.OperatorTotalTime || '-';
  const buildTimeStr = buildCommon.OperatorTotalTime || '-';
  const probeTimeSeconds = parseNumericValue(probeTimeStr);
  const buildTimeSeconds = parseNumericValue(buildTimeStr);

  // Calculate percentages based on total time from ALL operators
  const probeTimePct = totalTimeSeconds > 0 ? (probeTimeSeconds / totalTimeSeconds) * 100 : 0;
  const buildTimePct = totalTimeSeconds > 0 ? (buildTimeSeconds / totalTimeSeconds) * 100 : 0;

  return {
    // Summary section (from probe and build)
    planNodeId: join.planNodeId,
    joinType: probeUnique.JoinType || buildUnique.JoinType || '-',
    distributionMode: probeUnique.DistributionMode || buildUnique.DistributionMode || '-',
    totalTime: formatTime(totalTimeSeconds),
    totalTimeSeconds: totalTimeSeconds,
    joinPredicates: buildUnique.JoinPredicates || probeUnique.JoinPredicates || '-',

    // Probe side metrics
    probe: {
      pushRowNum: probeCommon.PushRowNum || '-',
      pullRowNum: probeCommon.PullRowNum || '-',
      operatorTotalTime: probeTimeStr,
      operatorTimePct: probeTimePct,
      searchHashTableTime: probeUnique.SearchHashTableTime || '-',
      probeConjunctEvaluateTime: probeUnique.ProbeConjunctEvaluateTime || '-',
      outputChunkBytes: probeCommon.OutputChunkBytes || '-'
    },

    // Build side metrics
    build: {
      pushRowNum: buildCommon.PushRowNum || '-',
      buildInputRows: buildInputRows || '-',  // Pre-broadcast/shuffle rows
      hashTableMemoryUsage: buildUnique.HashTableMemoryUsage || '-',
      peakRevocableMemoryBytes: buildUnique.PeakRevocableMemoryBytes || '-',
      operatorTotalTime: buildTimeStr,
      operatorTimePct: buildTimePct,
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

  // Parse Topology to get node relationships
  const topologyMap = parseTopology(execution);

  // Find all HASH_JOIN operators
  const { probes, builds } = findHashJoins(execution);

  // Combine probe and build sides
  const joins = combineJoinOperators(probes, builds);

  // Get all plan_node_ids from joins
  const planNodeIds = new Set(joins.map(j => j.planNodeId));

  // Sum OperatorTotalTime for ALL operators with each plan_node_id
  const totalTimesByPlanNodeId = sumOperatorTimesByPlanNodeId(execution, planNodeIds);

  // Extract metrics for each join, passing the total time from all operators
  const joinMetrics = joins.map(join => {
    const totalTime = totalTimesByPlanNodeId.get(join.planNodeId) || 0;

    // Find build side EXCHANGE and get pre-broadcast/shuffle row count
    let buildInputRows = null;
    if (topologyMap) {
      const buildExchangeId = findBuildSideExchange(join.planNodeId, topologyMap);
      if (buildExchangeId) {
        buildInputRows = getExchangeSinkPushRowNum(execution, buildExchangeId);
      }
    }

    return extractJoinMetrics(join, totalTime, buildInputRows);
  });

  console.log(`Found ${joins.length} HASH_JOIN operators`);
  console.log('Total times by plan_node_id:', Object.fromEntries(totalTimesByPlanNodeId));
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
      totalTime: '-',
      totalBuildTime: '-',
      totalBuildTimePct: 0,
      totalProbeTime: '-',
      totalProbeTimePct: 0,
      totalHashTableMemory: '-',
      maxHashTableMemory: '-',
      totalRowsSpilled: 0
    };
  }

  let totalHashTableMemoryBytes = 0;
  let totalTimeSeconds = 0;
  let totalBuildTimeSeconds = 0;
  let totalProbeTimeSeconds = 0;
  let maxHashTableMemoryBytes = 0;
  let totalRowsSpilled = 0;

  for (const join of joins) {
    // Sum total time from all operators (already calculated per join)
    if (join.totalTimeSeconds) {
      totalTimeSeconds += join.totalTimeSeconds;
    }

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

  // Calculate percentages
  const totalBuildTimePct = totalTimeSeconds > 0 ? (totalBuildTimeSeconds / totalTimeSeconds) * 100 : 0;
  const totalProbeTimePct = totalTimeSeconds > 0 ? (totalProbeTimeSeconds / totalTimeSeconds) * 100 : 0;

  return {
    totalJoins: joins.length,
    totalTime: formatTime(totalTimeSeconds),
    totalBuildTime: formatTime(totalBuildTimeSeconds),
    totalBuildTimePct: totalBuildTimePct,
    totalProbeTime: formatTime(totalProbeTimeSeconds),
    totalProbeTimePct: totalProbeTimePct,
    totalHashTableMemory: formatBytes(totalHashTableMemoryBytes),
    maxHashTableMemory: formatBytes(maxHashTableMemoryBytes),
    totalRowsSpilled: totalRowsSpilled
  };
}
