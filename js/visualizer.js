/**
 * Query Plan Visualization
 * Renders the execution plan tree from the Topology structure
 */

// Tree layout constants
const NODE_WIDTH = 140;
const NODE_HEIGHT = 50;
const HORIZONTAL_SPACING = 30;
const VERTICAL_SPACING = 70;

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

  // Use Topology (the logical plan structure)
  if (!execution.Topology) {
    alert('No Topology found in execution data');
    return;
  }

  try {
    const topology = JSON.parse(execution.Topology);
    renderFromTopology(topology);
  } catch (err) {
    alert('Failed to parse Topology: ' + err.message);
  }
}

/**
 * Render from the Topology structure (logical plan)
 */
function renderFromTopology(topology) {
  const { rootId, nodes } = topology;
  
  // Build graph structure
  const graph = {};
  for (const node of nodes) {
    graph[node.id] = {
      id: node.id,
      name: node.name,
      planNodeId: node.id,
      children: node.children || [],
      properties: node.properties || {}
    };
  }
  
  // Find root
  const root = graph[rootId];
  if (!root) {
    alert('Could not find root node in topology');
    return;
  }
  
  // Calculate layout
  const layout = calculateTreeLayout(root, graph);
  
  // Render
  renderTreeWithSVG(layout, graph);
  
  // Show the plan container
  planDropZone.style.display = 'none';
  planContainer.style.display = 'block';
}

/**
 * Calculate tree layout positions
 */
function calculateTreeLayout(root, graph) {
  // First pass: calculate subtree widths
  function calcSubtreeWidth(node, visited = new Set()) {
    if (visited.has(node.id)) {
      return NODE_WIDTH; // Prevent cycles
    }
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
        if (i < node.children.length - 1) {
          totalWidth += HORIZONTAL_SPACING;
        }
      }
    });
    
    node._width = Math.max(NODE_WIDTH, totalWidth);
    return node._width;
  }
  
  calcSubtreeWidth(root);
  
  // Second pass: assign positions
  const positions = {};
  let maxY = 0;
  
  function assignPositions(node, x, y, visited = new Set()) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    
    positions[node.id] = { 
      x: x + (node._width - NODE_WIDTH) / 2, 
      y: y
    };
    
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
  
  return {
    positions,
    width: root._width,
    height: maxY + NODE_HEIGHT,
    root
  };
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
 * Render the tree with SVG edges
 */
function renderTreeWithSVG(layout, graph) {
  const { positions, width, height, root } = layout;
  const padding = 40;
  
  // Check for empty layout
  if (!root || Object.keys(positions).length === 0) {
    planCanvas.innerHTML = '<div style="padding: 2rem; color: #f85149;">No operators found to visualize</div>';
    return;
  }
  
  // Collect all edges
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
  
  // Render edges as SVG paths
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
      edgeSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" 
                        fill="none" stroke="#30363d" stroke-width="1.5"/>`;
    }
  }
  
  // Render nodes
  let nodesHtml = '';
  for (const [id, pos] of Object.entries(positions)) {
    const node = graph[id];
    if (!node) continue;
    
    const nodeClass = getNodeClass(node.name);
    const displayName = node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name;
    
    nodesHtml += `
      <div class="plan-node ${nodeClass}" 
           style="left: ${pos.x + padding}px; top: ${pos.y + padding}px;"
           data-node-id="${id}"
           title="${node.name} (id=${node.planNodeId})">
        <div class="plan-node-name">${displayName}</div>
        <div class="plan-node-id">id=${node.planNodeId}</div>
      </div>
    `;
  }
  
  // Create container
  const containerHtml = `
    <div class="plan-svg-container" style="position: relative; width: ${width + padding * 2}px; height: ${height + padding * 2}px;">
      <svg class="plan-svg" width="${width + padding * 2}" height="${height + padding * 2}">
        <g transform="translate(${padding}, ${padding})">
          ${edgeSvg}
        </g>
      </svg>
      <div class="plan-nodes-container" style="position: absolute; top: 0; left: 0; width: ${width + padding * 2}px; height: ${height + padding * 2}px;">
        ${nodesHtml}
      </div>
    </div>
  `;
  
  planCanvas.innerHTML = containerHtml;
}
