/**
 * JSON parsing functions for query profiles
 */

/**
 * Recursively find all CONNECTOR_SCAN operators in the execution data
 */
export function findConnectorScans(obj, path = '', context = {}) {
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
    
    // Check if this key is a CONNECTOR_SCAN operator
    if (key.startsWith('CONNECTOR_SCAN')) {
      // Extract the plan_node_id from the key, e.g., "CONNECTOR_SCAN (plan_node_id=66)"
      const match = key.match(/plan_node_id=(\d+)/);
      const planNodeId = match ? match[1] : 'unknown';
      
      results.push({
        id: planNodeId,
        planNodeId: planNodeId,
        pipelineId: newContext.pipelineId || 'unknown',
        fragmentId: newContext.fragmentId || 'unknown',
        path: path + ' > ' + key,
        commonMetrics: value.CommonMetrics || {},
        uniqueMetrics: value.UniqueMetrics || {}
      });
    }
    
    // If the value is an object, search recursively
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = findConnectorScans(value, path ? `${path} > ${key}` : key, newContext);
      results.push(...nested);
    }
  }
  
  return results;
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

  // Find all CONNECTOR_SCAN operators by recursively searching
  const connectorScans = findConnectorScans(execution);
  
  console.log(`Found ${connectorScans.length} CONNECTOR_SCAN operators`);
  console.log('CONNECTOR_SCAN data:', connectorScans);

  return { summary, execution, connectorScans };
}

