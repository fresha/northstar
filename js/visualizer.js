/**
 * Query Plan Visualization
 * Renders the execution plan tree from the Topology structure
 */

// Tree layout constants
const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const HORIZONTAL_SPACING = 40;
const VERTICAL_SPACING = 80;

// DOM elements
let planDropZone, planFileInput, planContainer, planCanvas, planReset;

/**
 * Setup plan visualization drop zone
 */
export function setupPlanDropZone() {
  planDropZone = document.getElementById('planDropZone');
  planFileInput = document.getElementById('planFileInput');
  planContainer = document.getElementById('planContainer');
  planCanvas = document.getElementById('planCanvas');
  planReset = document.getElementById('planReset');

  planDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    planDropZone.classList.add('drag-over');
  });

  planDropZone.addEventListener('dragleave', () => {
    planDropZone.classList.remove('drag-over');
  });

  planDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    planDropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadPlanFile(file);
  });

  planDropZone.addEventListener('click', () => planFileInput.click());
  planFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadPlanFile(e.target.files[0]);
  });

  planReset.addEventListener('click', () => {
    planDropZone.style.display = 'block';
    planContainer.style.display = 'none';
    planCanvas.innerHTML = '';
  });
  
  // Global toggle function
  window.toggleNodeMetrics = function(nodeId, event) {
    event.stopPropagation();
    const dropdown = document.getElementById(`metrics-${nodeId}`);
    const icon = document.getElementById(`icon-${nodeId}`);
    const node = document.getElementById(`node-${nodeId}`);
    
    if (!dropdown) return;
    
    const isHidden = dropdown.style.display === 'none';
    
    // Close all other dropdowns first
    document.querySelectorAll('.node-metrics-dropdown').forEach(d => {
      d.style.display = 'none';
    });
    document.querySelectorAll('.expand-icon').forEach(i => {
      i.textContent = '▼';
    });
    document.querySelectorAll('.plan-node').forEach(n => {
      n.style.zIndex = '1';
      n.style.width = '160px';
    });
    
    // Toggle current one
    if (isHidden) {
      dropdown.style.display = 'block';
      icon.textContent = '▲';
      node.style.zIndex = '100';
      node.style.width = '320px';
    }
  };
  
  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.plan-node')) {
      document.querySelectorAll('.node-metrics-dropdown').forEach(d => {
        d.style.display = 'none';
      });
      document.querySelectorAll('.expand-icon').forEach(i => {
        i.textContent = '▼';
      });
      document.querySelectorAll('.plan-node').forEach(n => {
        n.style.zIndex = '1';
        n.style.width = '160px';
      });
    }
  });
}

/**
 * Load plan file
 */
function loadPlanFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      renderPlan(data);
    } catch (err) {
      alert('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}

/**
 * Render the execution plan
 */
function renderPlan(data) {
  const execution = data?.Query?.Execution;
  if (!execution) {
    alert('No execution data found in this profile');
    return;
  }

  if (!execution.Topology) {
    alert('No Topology found in execution data');
    return;
  }

  try {
    const topology = JSON.parse(execution.Topology);
    const metricsMap = extractMetricsByPlanNodeId(execution);
    renderFromTopology(topology, metricsMap);
  } catch (err) {
    alert('Failed to parse Topology: ' + err.message);
  }
}

/**
 * Extract operator metrics from fragments, indexed by plan_node_id
 */
function extractMetricsByPlanNodeId(execution) {
  const metricsMap = {};
  
  for (const key of Object.keys(execution)) {
    if (!key.startsWith('Fragment ')) continue;
    
    const fragment = execution[key];
    
    for (const pipeKey of Object.keys(fragment)) {
      const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
      if (!pipeMatch) continue;
      
      const pipeline = fragment[pipeKey];
      
      for (const opKey of Object.keys(pipeline)) {
        const opMatch = opKey.match(/(.+) \(plan_node_id=(-?\d+)\)/);
        if (!opMatch) continue;
        
        const opName = opMatch[1];
        const planNodeId = parseInt(opMatch[2]);
        
        if (!metricsMap[planNodeId]) {
          metricsMap[planNodeId] = {
            instances: []
          };
        }
        
        // Store operator name with each instance for proper matching
        metricsMap[planNodeId].instances.push({
          operatorName: opName,
          metrics: pipeline[opKey]
        });
      }
    }
  }
  
  return metricsMap;
}

/**
 * Get aggregated metrics for a scan operator
 * Looks through all instances to find the actual SCAN operator (not CHUNK_ACCUMULATE etc.)
 */
function getScanMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  // Find the SCAN instance (CONNECTOR_SCAN, OLAP_SCAN, etc.)
  let scanInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName.includes('SCAN')) {
      scanInstance = inst.metrics;
      break;
    }
  }
  
  // Fallback to first instance if no scan found
  if (!scanInstance) {
    scanInstance = metricsData.instances[0].metrics;
  }
  
  const common = scanInstance.CommonMetrics || {};
  const unique = scanInstance.UniqueMetrics || {};
  
  return {
    operatorTotalTime: common.OperatorTotalTime || 'N/A',
    pullRowNum: common.PullRowNum || '0',
    table: unique.Table || unique.Rollup || 'N/A',
    bytesRead: unique.BytesRead || '0 B',
    rowsRead: unique.RowsRead || '0',
    rawRowsRead: unique.RawRowsRead || '0',
    scanTime: unique.ScanTime || '0ns',
    tabletCount: unique.TabletCount || '0'
  };
}

/**
 * Render from the Topology structure (logical plan)
 */
function renderFromTopology(topology, metricsMap) {
  const { rootId, nodes } = topology;
  
  const graph = {};
  for (const node of nodes) {
    graph[node.id] = {
      id: node.id,
      name: node.name,
      planNodeId: node.id,
      children: node.children || [],
      properties: node.properties || {},
      metrics: metricsMap[node.id] || null
    };
  }
  
  const root = graph[rootId];
  if (!root) {
    alert('Could not find root node in topology');
    return;
  }
  
  const layout = calculateTreeLayout(root, graph);
  renderTreeWithSVG(layout, graph);
  
  planDropZone.style.display = 'none';
  planContainer.style.display = 'block';
}

/**
 * Calculate tree layout positions
 */
function calculateTreeLayout(root, graph) {
  function calcSubtreeWidth(node, visited = new Set()) {
    if (visited.has(node.id)) return NODE_WIDTH;
    visited.add(node.id);
    
    if (!node.children || node.children.length === 0) {
      node._width = NODE_WIDTH;
      return NODE_WIDTH;
    }
    
    let totalWidth = 0;
    node.children.forEach((childId, i) => {
      const child = graph[childId];
      if (child) {
        totalWidth += calcSubtreeWidth(child, visited);
        if (i < node.children.length - 1) totalWidth += HORIZONTAL_SPACING;
      }
    });
    
    node._width = Math.max(NODE_WIDTH, totalWidth);
    return node._width;
  }
  
  calcSubtreeWidth(root);
  
  const positions = {};
  let maxY = 0;
  
  function assignPositions(node, x, y, visited = new Set()) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    
    positions[node.id] = { x: x + (node._width - NODE_WIDTH) / 2, y };
    maxY = Math.max(maxY, y);
    
    if (node.children && node.children.length > 0) {
      let childX = x;
      node.children.forEach(childId => {
        const child = graph[childId];
        if (child) {
          assignPositions(child, childX, y + NODE_HEIGHT + VERTICAL_SPACING, visited);
          childX += (child._width || NODE_WIDTH) + HORIZONTAL_SPACING;
        }
      });
    }
  }
  
  assignPositions(root, 0, 0);
  
  return { positions, width: root._width, height: maxY + NODE_HEIGHT, root };
}

/**
 * Get CSS class for node based on operator type
 */
function getNodeClass(name) {
  const n = name.toUpperCase();
  if (n.includes('SCAN')) return 'scan';
  if (n.includes('JOIN')) return 'join';
  if (n.includes('EXCHANGE') || n.includes('MERGE')) return 'exchange';
  if (n.includes('PROJECT') || n.includes('LIMIT') || n.includes('TOP_N')) return 'project';
  if (n.includes('AGGREGATE') || n.includes('AGG')) return 'aggregate';
  if (n.includes('UNION')) return 'union';
  if (n.includes('SORT')) return 'project';
  return '';
}

/**
 * Check if node is a scan operator
 */
function isScanOperator(name) {
  return name.toUpperCase().includes('SCAN');
}

/**
 * Get row count (PullRowNum) from a node's metrics
 * Returns formatted string or null if not available
 */
function getNodeRowCount(node) {
  if (!node || !node.metrics || !node.metrics.instances) return null;
  
  // Find an instance with PullRowNum
  for (const inst of node.metrics.instances) {
    const common = inst.metrics?.CommonMetrics;
    if (common && common.PullRowNum) {
      return formatRowCount(common.PullRowNum);
    }
  }
  return null;
}

/**
 * Format row count for display (e.g., "1.5K", "2.3M")
 */
function formatRowCount(value) {
  if (!value) return null;
  
  // Handle string values like "207.615K (207615)"
  let numStr = String(value);
  
  // If it already has K/M suffix, extract just the short form
  const match = numStr.match(/^([\d.]+[KMB]?)/i);
  if (match) {
    return match[1];
  }
  
  // Parse as number and format
  const num = parseFloat(numStr.replace(/[,\s]/g, ''));
  if (isNaN(num)) return value;
  
  if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

/**
 * Build metrics dropdown HTML for scan nodes
 */
function buildMetricsDropdown(node) {
  if (!isScanOperator(node.name) || !node.metrics) return '';
  
  const m = getScanMetrics(node.metrics);
  if (!m) return '';
  
  const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;gap:12px;';
  const labelStyle = 'color:#8b949e;font-size:11px;white-space:nowrap;flex-shrink:0;';
  const valueStyle = 'color:#e6edf3;font-size:11px;font-weight:500;text-align:right;word-break:break-all;';
  const timeStyle = valueStyle + 'color:#3fb950;';
  const bytesStyle = valueStyle + 'color:#d29922;';
  const rowsStyle = valueStyle + 'color:#a5d6ff;';
  
  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #30363d;">
      <div style="${rowStyle}"><span style="${labelStyle}">Table</span><span style="${valueStyle}">${m.table}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Operator Time</span><span style="${timeStyle}">${m.operatorTotalTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Scan Time</span><span style="${timeStyle}">${m.scanTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Bytes Read</span><span style="${bytesStyle}">${m.bytesRead}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Pull Rows</span><span style="${rowsStyle}">${m.pullRowNum}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Rows Read</span><span style="${rowsStyle}">${m.rowsRead}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Raw Rows Read</span><span style="${rowsStyle}">${m.rawRowsRead}</span></div>
      <div style="${rowStyle};border-bottom:none;"><span style="${labelStyle}">Tablets</span><span style="${valueStyle}">${m.tabletCount}</span></div>
    </div>
  `;
}

/**
 * Render the tree with SVG edges
 */
function renderTreeWithSVG(layout, graph) {
  const { positions, width, height, root } = layout;
  const padding = 40;
  
  if (!root || Object.keys(positions).length === 0) {
    planCanvas.innerHTML = '<div style="padding:2rem;color:#f85149;">No operators found</div>';
    return;
  }
  
  // Collect edges
  const edges = [];
  const visited = new Set();
  
  function collectEdges(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (node.children) {
      for (const childId of node.children) {
        const child = graph[childId];
        if (child && positions[childId]) {
          edges.push({ from: node.id, to: childId });
          collectEdges(child);
        }
      }
    }
  }
  collectEdges(root);
  
  // Render SVG edges with row count labels
  let edgeSvg = '';
  for (const edge of edges) {
    const fromPos = positions[edge.from];
    const toPos = positions[edge.to];
    if (fromPos && toPos) {
      const x1 = fromPos.x + NODE_WIDTH / 2;
      const y1 = fromPos.y + NODE_HEIGHT;
      const x2 = toPos.x + NODE_WIDTH / 2;
      const y2 = toPos.y;
      const midY = (y1 + y2) / 2;
      
      // Draw the edge path
      edgeSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="#30363d" stroke-width="1.5"/>`;
      
      // Get row count from the child node (source of data flow)
      const childNode = graph[edge.to];
      const rowCount = getNodeRowCount(childNode) || '0';
      
      if (rowCount) {
        // Calculate label position (on the bezier curve, slightly above midpoint)
        const labelX = (x1 + x2) / 2;
        const labelY = midY - 5;
        const labelWidth = rowCount.length * 7 + 12;
        
        edgeSvg += `
          <rect x="${labelX - labelWidth/2}" y="${labelY - 10}" width="${labelWidth}" height="18" rx="4" fill="#161b22" stroke="#30363d" stroke-width="1"/>
          <text x="${labelX}" y="${labelY + 2}" text-anchor="middle" fill="#a5d6ff" font-size="10" font-family="JetBrains Mono, monospace">${rowCount}</text>
        `;
      }
    }
  }
  
  // Render nodes
  let nodesHtml = '';
  for (const [id, pos] of Object.entries(positions)) {
    const node = graph[id];
    if (!node) continue;
    
    const nodeClass = getNodeClass(node.name);
    const displayName = node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name;
    const hasMetrics = isScanOperator(node.name) && node.metrics;
    const metricsDropdown = buildMetricsDropdown(node);
    
    const nodeStyle = `
      position:absolute;
      left:${pos.x + padding}px;
      top:${pos.y + padding}px;
      width:160px;
      background:#161b22;
      border:1px solid #30363d;
      border-radius:8px;
      padding:8px 10px;
      text-align:center;
      z-index:1;
      ${hasMetrics ? 'cursor:pointer;' : ''}
    `;
    
    const borderColor = nodeClass === 'scan' ? '#d29922' : 
                        nodeClass === 'join' ? '#f85149' : 
                        nodeClass === 'exchange' ? '#58a6ff' : 
                        nodeClass === 'aggregate' ? '#a371f7' : 
                        nodeClass === 'union' ? '#3fb950' : '#8b949e';
    
    nodesHtml += `
      <div id="node-${id}" class="plan-node ${nodeClass} ${hasMetrics ? 'has-metrics' : ''}" 
           style="${nodeStyle}border-left:3px solid ${borderColor};"
           ${hasMetrics ? `onclick="toggleNodeMetrics('${id}', event)"` : ''}>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="font-size:11px;font-weight:600;color:#e6edf3;">${displayName}</span>
          ${hasMetrics ? `<span id="icon-${id}" class="expand-icon" style="font-size:8px;color:#00d4aa;">▼</span>` : ''}
        </div>
        <div style="font-size:10px;color:#8b949e;margin-top:2px;">id=${node.planNodeId}</div>
        ${metricsDropdown}
      </div>
    `;
  }
  
  planCanvas.innerHTML = `
    <div style="position:relative;width:${width + padding * 2}px;height:${height + padding * 2}px;">
      <svg style="position:absolute;top:0;left:0;" width="${width + padding * 2}" height="${height + padding * 2}">
        <g transform="translate(${padding}, ${padding})">${edgeSvg}</g>
      </svg>
      <div style="position:absolute;top:0;left:0;width:${width + padding * 2}px;height:${height + padding * 2}px;">
        ${nodesHtml}
      </div>
    </div>
  `;
}
