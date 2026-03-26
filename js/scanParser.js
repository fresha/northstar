/**
 * JSON parsing functions for query profiles
 */

/**
 * Check if a key is a primary scan operator (CONNECTOR_SCAN or OLAP_SCAN, but not OLAP_SCAN_PREPARE)
 * @param {string} key - The operator key to check
 * @returns {boolean} - True if this is a primary scan operator
 */
function isPrimaryScanOperator(key) {
  // Match CONNECTOR_SCAN (for external/Iceberg tables)
  if (key.startsWith('CONNECTOR_SCAN')) {
    return true;
  }
  // Match OLAP_SCAN but NOT OLAP_SCAN_PREPARE (for native StarRocks tables)
  // The regex ensures we match "OLAP_SCAN (" but not "OLAP_SCAN_PREPARE ("
  if (key.match(/^OLAP_SCAN \(/)) {
    return true;
  }
  return false;
}

/**
 * Recursively find all primary scan operators (CONNECTOR_SCAN, OLAP_SCAN) in the execution data
 * Note: Excludes OLAP_SCAN_PREPARE which is a preparation phase operator with minimal metrics
 */
export function findScanOperators(obj, path = '', context = {}) {
  const results = [];

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

    // Check if this key is a primary scan operator (CONNECTOR_SCAN or OLAP_SCAN)
    if (isPrimaryScanOperator(key)) {
      // Extract the plan_node_id from the key, e.g., "CONNECTOR_SCAN (plan_node_id=66)" or "OLAP_SCAN (plan_node_id=11)"
      const match = key.match(/plan_node_id=(\d+)/);
      const planNodeId = match ? match[1] : 'unknown';

      // Extract operator type from key
      const operatorType = key.startsWith('CONNECTOR_SCAN') ? 'CONNECTOR_SCAN' : 'OLAP_SCAN';

      const uniqueMetrics = value.UniqueMetrics || {};
      results.push({
        id: planNodeId,
        planNodeId: planNodeId,
        pipelineId: newContext.pipelineId || 'unknown',
        fragmentId: newContext.fragmentId || 'unknown',
        path: path + ' > ' + key,
        operatorType: operatorType,
        dataSourceType: uniqueMetrics.DataSourceType || null,
        commonMetrics: value.CommonMetrics || {},
        uniqueMetrics: uniqueMetrics
      });
    }

    // If the value is an object, search recursively
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findScanOperators(value, path ? `${path} > ${key}` : key, newContext);
      results.push(...nested);
    }
  }

  return results;
}

// Backward compatibility alias
export const findConnectorScans = findScanOperators;

/**
 * Classify scan operators into internal (OLAP/Lake) vs external (Iceberg/Hive)
 * Internal: OLAP_SCAN or CONNECTOR_SCAN with LakeDataSource
 * External: CONNECTOR_SCAN with HiveDataSource (Iceberg, Hive, etc.)
 */
export function classifyScanOperators(scans) {
  const internalScans = [];
  const externalScans = [];
  for (const scan of scans) {
    if (scan.operatorType === 'CONNECTOR_SCAN' && scan.dataSourceType === 'HiveDataSource') {
      externalScans.push(scan);
    } else {
      internalScans.push(scan);
    }
  }
  return { internalScans, externalScans };
}

/**
 * Process a query profile JSON and extract relevant data
 */
export function processQueryProfile(json) {
  const query = json.Query;
  if (!query) {
    throw new Error('Invalid query profile format: missing "Query" object');
  }

  // Extract basic query info from Summary
  const summary = query.Summary || {};
  const execution = query.Execution || {};

  // Find all primary scan operators (CONNECTOR_SCAN or OLAP_SCAN) by recursively searching
  const connectorScans = findScanOperators(execution);

  return { summary, execution, connectorScans };
}

