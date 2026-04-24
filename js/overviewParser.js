/**
 * Overview parser
 * Extracts fragment and pipeline timing data for the overview dashboard
 */

import { parseNumericValue } from './utils.js';

/**
 * Extract all fragments with their pipelines and timing data
 */
export function extractFragments(execution) {
  const fragments = [];

  for (const key in execution) {
    const fragmentMatch = key.match(/^Fragment (\d+)$/);
    if (!fragmentMatch) continue;

    const fragmentId = parseInt(fragmentMatch[1]);
    const fragmentData = execution[key];

    const fragment = {
      id: fragmentId,
      pipelines: [],
      totalActiveTime: 0,
    };

    // Extract pipelines
    for (const pipelineKey in fragmentData) {
      const pipelineMatch = pipelineKey.match(/^Pipeline \(id=(\d+)\)$/);
      if (!pipelineMatch) continue;

      const pipelineId = parseInt(pipelineMatch[1]);
      const pipelineData = fragmentData[pipelineKey];

      // Core timing metrics
      const activeTime = parseNumericValue(pipelineData.ActiveTime);
      const driverTotalTime = parseNumericValue(pipelineData.DriverTotalTime);
      const scheduleTime = parseNumericValue(pipelineData.ScheduleTime);
      const inputEmptyTime = parseNumericValue(pipelineData.InputEmptyTime);

      const pipeline = {
        id: pipelineId,
        fragmentId: fragmentId,
        activeTime: activeTime,
        driverTotalTime: driverTotalTime,
        scheduleTime: scheduleTime,
        inputEmptyTime: inputEmptyTime,
        operators: [],
      };

      // Extract operators within this pipeline
      for (const opKey in pipelineData) {
        if (opKey.includes('(plan_node_id=')) {
          const opData = pipelineData[opKey];
          const operatorTime = parseNumericValue(opData.CommonMetrics?.OperatorTotalTime);

          pipeline.operators.push({
            name: opKey,
            operatorTime: operatorTime,
            operatorTimeStr: opData.CommonMetrics?.OperatorTotalTime || '0ns',
          });
        }
      }

      // Sort operators by time (descending)
      pipeline.operators.sort((a, b) => b.operatorTime - a.operatorTime);

      fragment.pipelines.push(pipeline);
      fragment.totalActiveTime += activeTime;
    }

    fragments.push(fragment);
  }

  // Sort fragments by ID
  fragments.sort((a, b) => a.id - b.id);

  return fragments;
}

/**
 * Analyze fragments for overview stats
 */
export function analyzeFragments(fragments, execution) {
  const queryWallTime = parseNumericValue(execution.QueryExecutionWallTime);

  // Calculate total active time across all fragments
  const totalActiveTime = fragments.reduce((sum, f) => sum + f.totalActiveTime, 0);

  return {
    queryWallTime,
    totalActiveTime,
    fragments,
  };
}

/**
 * Extract planner timing data (values in seconds)
 * Parses keys like "-- Total[1] 1s149ms": "" to extract timing values
 */
function extractPlannerTiming(planner) {
  if (!planner || typeof planner !== 'object') {
    return null;
  }

  const timing = {
    total: 0,
    analyzer: 0,
    transformer: 0,
    optimizer: 0,
    execPlanBuild: 0,
    deploy: 0,
    parser: 0,
    pending: 0,
    prepare: 0,
  };

  // Parse planner keys to extract timing
  // Keys vary by SR version:
  //   "-- Total[1] 1s149ms"  (with -- prefix and optional indentation)
  //   "Total[1] 387ms"       (without prefix)
  // Use parseNumericValue() to handle compound time strings like "1s149ms"
  for (const key of Object.keys(planner)) {
    const match = key.match(/(?:--\s*)?(\w+)\[.*?\]\s*(.+)/);
    if (!match) continue;

    const name = match[1].toLowerCase();
    const timeStr = match[2].trim();
    const value = parseNumericValue(timeStr); // Returns seconds

    if (name === 'total') timing.total = value;
    else if (name === 'analyzer') timing.analyzer = value;
    else if (name === 'transformer') timing.transformer = value;
    else if (name === 'optimizer') timing.optimizer = value;
    else if (name === 'execplanbuild') timing.execPlanBuild = value;
    else if (name === 'deploy') timing.deploy = value;
    else if (name === 'parser') timing.parser = value;
    else if (name === 'pending') timing.pending = value;
    else if (name === 'prepare') timing.prepare = value;
  }

  // Parse ICEBERG.getScanFiles timing (has dots so the main regex above won't match)
  for (const key of Object.keys(planner)) {
    const icebergMatch = key.match(/ICEBERG\.getScanFiles\[.*?\]\s*(.+)/);
    if (icebergMatch) {
      timing.icebergGetScanFiles = parseNumericValue(icebergMatch[1].trim());
      break;
    }
  }

  // Parse Iceberg ScanMetrics from the ScanReport string (per table)
  const icebergData = planner.ICEBERG?.ScanMetrics;
  if (icebergData) {
    timing.icebergTables = parseIcebergScanMetrics(icebergData);
  }

  // Only return if we found valid data
  return timing.total > 0 ? timing : null;
}

/**
 * Parse Iceberg ScanMetrics from the planner's ICEBERG.ScanMetrics object.
 * Each key is a table identifier, each value is a ScanReport toString() dump.
 * Returns an array of parsed table metrics.
 */
function parseIcebergScanMetrics(scanMetrics) {
  const tables = [];

  for (const [tableKey, reportStr] of Object.entries(scanMetrics)) {
    // Extract table name from key like "IcebergTableName{dbName='...', tableName='...'}"
    const tableNameMatch = tableKey.match(/tableName='([^']+)'/);
    const tableName = tableNameMatch ? tableNameMatch[1] : tableKey;

    // Extract filter from report
    const filterMatch = reportStr.match(/filter=(.+?), schemaId=/);
    const filter = filterMatch ? filterMatch[1] : null;

    // Helper to extract CounterResult values
    const counter = (name) => {
      const m = reportStr.match(new RegExp(`${name}=CounterResult\\{unit=\\w+, value=(\\d+)\\}`));
      return m ? parseInt(m[1]) : 0;
    };

    // Helper to extract planning duration
    const durationMatch = reportStr.match(/totalPlanningDuration=TimerResult\{.*?totalDuration=PT(\d+(?:\.\d+)?)S/);
    const planningDuration = durationMatch ? parseFloat(durationMatch[1]) : 0;

    tables.push({
      tableName,
      filter,
      planningDuration,
      // Data manifests
      totalDataManifests: counter('totalDataManifests'),
      scannedDataManifests: counter('scannedDataManifests'),
      skippedDataManifests: counter('skippedDataManifests'),
      // Data files
      resultDataFiles: counter('resultDataFiles'),
      skippedDataFiles: counter('skippedDataFiles'),
      totalFileSizeInBytes: counter('totalFileSizeInBytes'),
      // Delete manifests
      totalDeleteManifests: counter('totalDeleteManifests'),
      scannedDeleteManifests: counter('scannedDeleteManifests'),
      skippedDeleteManifests: counter('skippedDeleteManifests'),
      // Delete files
      resultDeleteFiles: counter('resultDeleteFiles'),
      skippedDeleteFiles: counter('skippedDeleteFiles'),
      positionalDeleteFiles: counter('positionalDeleteFiles'),
      equalityDeleteFiles: counter('equalityDeleteFiles'),
      totalDeleteFileSizeInBytes: counter('totalDeleteFileSizeInBytes'),
    });
  }

  return tables;
}

/**
 * Main entry point - process query profile for overview analysis
 */
export function processOverview(json) {
  const query = json.Query;
  if (!query) {
    throw new Error('Invalid query profile format: missing "Query" object');
  }

  const summary = query.Summary || {};
  const execution = query.Execution || {};
  const planner = query.Planner || {};

  // Extract fragments and pipelines
  const fragments = extractFragments(execution);

  // Analyze fragments
  const analysis = analyzeFragments(fragments, execution);

  // Add execution-level stats
  analysis.executionStats = {
    allocatedMemory: execution.QueryAllocatedMemoryUsage || 'N/A',
    deallocatedMemory: execution.QueryDeallocatedMemoryUsage || 'N/A',
    peakMemory: execution.QueryPeakMemoryUsagePerNode || 'N/A',
    sumMemory: execution.QuerySumMemoryUsage || 'N/A',
    cpuTime: execution.QueryCumulativeCpuTime || 'N/A',
    operatorTime: execution.QueryCumulativeOperatorTime || 'N/A',
    scanTime: execution.QueryCumulativeScanTime || 'N/A',
    networkTime: execution.QueryCumulativeNetworkTime || 'N/A',
    spillBytes: execution.QuerySpillBytes || '0 B',
  };

  // Add planner timing
  analysis.plannerTiming = extractPlannerTiming(planner);

  return { summary, execution, analysis };
}
