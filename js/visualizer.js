/**
 * Query Plan Visualization
 * Renders the execution plan tree from the Topology structure
 */

import { trackEvent } from './analytics.js';
import { setQuery, addListener, getQuery } from './queryState.js';

// Tree layout constants
const NODE_WIDTH = 160;
const NODE_HEIGHT = 65;
const HORIZONTAL_SPACING = 40;
const VERTICAL_SPACING = 80;

// Viewport constants
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.1;
const PAN_STEP = 80;

// Viewport state
let camera = { x: 0, y: 0, zoom: 1 };
let viewportState = {
  isPanning: false,
  isSpacePressed: false,
  startX: 0,
  startY: 0,
  startCameraX: 0,
  startCameraY: 0,
  pointerId: null
};
let currentContentSize = { width: 0, height: 0 };
let indicatorTimeout = null;
let currentNodePositions = {}; // For minimap rendering

// Filter state
let currentGraph = null;      // Store graph for filtering
let currentRootId = null;     // Store root for traversal
let currentParentMap = null;  // Cached parent map for upstream traversal

// Slowest operators panel state
let slowestPanelVisible = false;
let rankedOperators = [];

// DOM elements
let planDropZone, planFileInput, planContainer, planCanvas;

/**
 * Setup plan visualization drop zone
 */
export function setupPlanDropZone() {
  planDropZone = document.getElementById('planDropZone');
  planFileInput = document.getElementById('planFileInput');
  planContainer = document.getElementById('planContainer');
  planCanvas = document.getElementById('planCanvas');

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

  planDropZone.addEventListener('click', () => window.showLoadModal && window.showLoadModal());
  planFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadPlanFile(e.target.files[0]);
  });

  // Listen for global query state changes
  addListener((query) => {
    if (query) {
      renderPlan(query);
    } else {
      // Clear the plan
      planDropZone.style.display = 'block';
      planContainer.style.display = 'none';
      planCanvas.innerHTML = '';
    }
  });
  
  // Global toggle function
  window.toggleNodeMetrics = function(nodeId, event) {
    event.stopPropagation();
    const dropdown = document.getElementById(`metrics-${nodeId}`);
    const icon = document.getElementById(`icon-${nodeId}`);
    const node = document.getElementById(`node-${nodeId}`);

    if (!dropdown) return;

    const isHidden = dropdown.style.display === 'none';

    // Toggle current node only (don't close others)
    if (isHidden) {
      dropdown.style.display = 'block';
      icon.textContent = '▲';
      node.style.zIndex = '100';
      node.classList.add('expanded');
      // Check if it's a join node (needs more width for predicates)
      const nodeTitle = node.querySelector('span')?.textContent || '';
      const expandedWidth = nodeTitle.toUpperCase().includes('JOIN') ? '380px' : '320px';
      node.style.width = expandedWidth;
    } else {
      dropdown.style.display = 'none';
      icon.textContent = '▼';
      node.style.zIndex = '1';
      node.classList.remove('expanded');
      node.style.width = '160px';
    }
  };
  
  // Close nodes only when clicking outside the entire plan container
  // (not when clicking empty space inside the canvas - that's for panning)
  document.addEventListener('click', (e) => {
    // Don't close if clicking inside the plan container at all
    if (e.target.closest('.plan-container')) {
      return;
    }
    // Close all expanded nodes when clicking outside
    document.querySelectorAll('.node-metrics-dropdown').forEach(d => {
      d.style.display = 'none';
    });
    document.querySelectorAll('.expand-icon').forEach(i => {
      i.textContent = '▼';
    });
    document.querySelectorAll('.plan-node').forEach(n => {
      n.style.zIndex = '1';
      n.classList.remove('expanded');
      n.style.width = '160px';
    });
  });

  // Wire up toolbar buttons
  document.getElementById('viewportZoomIn')?.addEventListener('click', () => zoomToCenter(ZOOM_STEP, true));
  document.getElementById('viewportZoomOut')?.addEventListener('click', () => zoomToCenter(1 / ZOOM_STEP, true));
  document.getElementById('viewportFit')?.addEventListener('click', () => fitToView(true));

  // Setup search bar
  setupPlanSearch();
}

/**
 * Refresh plan view when tab becomes visible
 * Called when switching to the Plan tab to fix layout calculated while hidden
 */
export function refreshPlanView() {
  if (!planContainer || planContainer.style.display === 'none') return;

  // Force minimap to re-render nodes (clear hash to bypass cache)
  const minimapNodes = document.querySelector('.minimap-nodes');
  if (minimapNodes) {
    minimapNodes.dataset.hash = '';
  }

  // Re-fit to view now that dimensions are correct
  requestAnimationFrame(() => {
    fitToView(false);
  });
}

// ========================================
// Viewport Functions
// ========================================

/**
 * Apply CSS transform to zoom-container
 */
function updateTransform(smooth = false) {
  const zoomContainer = planCanvas?.querySelector('.zoom-container');
  if (!zoomContainer) return;

  if (smooth) {
    zoomContainer.classList.add('smooth-transform');
    setTimeout(() => zoomContainer.classList.remove('smooth-transform'), 300);
  } else {
    zoomContainer.classList.remove('smooth-transform');
  }

  zoomContainer.style.transform =
    `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
  zoomContainer.style.transformOrigin = '0 0';

  updateZoomIndicator();
  updateMinimap();
}

/**
 * Clamp camera to prevent infinite panning
 */
function clampCameraToBounds() {
  if (currentContentSize.width === 0 || currentContentSize.height === 0) return;

  const rect = planCanvas.getBoundingClientRect();
  const viewportWidth = rect.width / camera.zoom;
  const viewportHeight = rect.height / camera.zoom;
  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;

  // Allow centering when viewport > content
  const marginX = Math.max(0, (viewportWidth - contentWidth) / 2);
  const marginY = Math.max(0, (viewportHeight - contentHeight) / 2);

  // Allow 50% overscroll beyond content
  const overscroll = 0.5;
  const minX = -contentWidth * overscroll - marginX;
  const maxX = contentWidth * (1 + overscroll) - viewportWidth + marginX;
  const minY = -contentHeight * overscroll - marginY;
  const maxY = contentHeight * (1 + overscroll) - viewportHeight + marginY;

  if (maxX > minX) camera.x = Math.max(minX, Math.min(maxX, camera.x));
  if (maxY > minY) camera.y = Math.max(minY, Math.min(maxY, camera.y));
}

/**
 * Zoom to a specific node by plan_node_id
 * @param {number} planNodeId - The plan_node_id to zoom to
 * @returns {boolean} - True if node was found and zoomed to
 */
export function zoomToNode(planNodeId) {
  const nodeElement = document.getElementById(`node-${planNodeId}`);
  if (!nodeElement || !planCanvas) return false;

  // Get node position from stored positions
  const pos = currentNodePositions[planNodeId];
  if (!pos) return false;

  const rect = planCanvas.getBoundingClientRect();

  // Set zoom to a reasonable level for viewing a node
  camera.zoom = 1.2;

  // Center the camera on the node
  const nodeWidth = NODE_WIDTH;
  const nodeHeight = NODE_HEIGHT;
  camera.x = pos.x + nodeWidth / 2 - rect.width / (2 * camera.zoom);
  camera.y = pos.y + nodeHeight / 2 - rect.height / (2 * camera.zoom);

  clampCameraToBounds();
  updateTransform(true);

  // Highlight the node temporarily
  nodeElement.classList.add('highlighted');
  setTimeout(() => nodeElement.classList.remove('highlighted'), 2000);

  return true;
}

/**
 * Fit content to view
 */
function fitToView(smooth = true) {
  if (!planCanvas) return;

  const containerRect = planCanvas.getBoundingClientRect();
  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;

  if (contentWidth === 0 || contentHeight === 0) return;

  // Calculate scale to fit with padding
  const padding = 40;
  const scaleX = (containerRect.width - padding * 2) / contentWidth;
  const scaleY = (containerRect.height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't zoom beyond 100%

  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));

  // Center content
  camera.x = -(containerRect.width / camera.zoom - contentWidth) / 2;
  camera.y = -(containerRect.height / camera.zoom - contentHeight) / 2;

  updateTransform(smooth);
}

/**
 * Fit view to show specific nodes
 * @param {Set<number>} nodeIds - Set of node IDs to fit
 * @param {boolean} smooth - Whether to animate the transition
 */
function fitToNodes(nodeIds, smooth = true) {
  if (!planCanvas || !nodeIds || nodeIds.size === 0) return;

  // Calculate bounding box of matching nodes
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const id of nodeIds) {
    const pos = currentNodePositions[id];
    if (pos) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
    }
  }

  if (minX === Infinity) return; // No valid positions found

  const containerRect = planCanvas.getBoundingClientRect();
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  if (contentWidth === 0 || contentHeight === 0) return;

  // Calculate scale to fit with padding
  const padding = 60;
  const scaleX = (containerRect.width - padding * 2) / contentWidth;
  const scaleY = (containerRect.height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 2); // Allow zoom up to 200% for small selections

  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));

  // Center on the bounding box
  const centerX = minX + contentWidth / 2;
  const centerY = minY + contentHeight / 2;
  camera.x = centerX - (containerRect.width / camera.zoom) / 2;
  camera.y = centerY - (containerRect.height / camera.zoom) / 2;

  clampCameraToBounds();
  updateTransform(smooth);
}

/**
 * Zoom to viewport center
 */
function zoomToCenter(zoomDelta, smooth = true) {
  if (!planCanvas) return;

  const rect = planCanvas.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  // Get world position at center before zoom
  const worldX = camera.x + centerX / camera.zoom;
  const worldY = camera.y + centerY / camera.zoom;

  // Apply zoom
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * zoomDelta));

  // Keep center point fixed
  camera.x = worldX - centerX / camera.zoom;
  camera.y = worldY - centerY / camera.zoom;

  clampCameraToBounds();
  updateTransform(smooth);
}

/**
 * Pan by pixel delta
 */
function panBy(dx, dy, smooth = false) {
  camera.x -= dx / camera.zoom;
  camera.y -= dy / camera.zoom;
  clampCameraToBounds();
  updateTransform(smooth);
}

/**
 * Update zoom indicator display
 */
function updateZoomIndicator() {
  const indicator = document.querySelector('.zoom-indicator');
  if (!indicator) return;

  const percent = Math.round(camera.zoom * 100);
  indicator.textContent = `${percent}%`;

  indicator.classList.remove('at-100', 'at-limit');
  if (Math.abs(camera.zoom - 1) < 0.01) {
    indicator.classList.add('at-100');
  } else if (camera.zoom <= MIN_ZOOM || camera.zoom >= MAX_ZOOM) {
    indicator.classList.add('at-limit');
  }

  indicator.classList.add('visible');
  clearTimeout(indicatorTimeout);
  indicatorTimeout = setTimeout(() => indicator.classList.remove('visible'), 1500);
}

/**
 * Update minimap display
 */
function updateMinimap() {
  const minimap = document.querySelector('.viewport-minimap');
  const minimapNodes = document.querySelector('.minimap-nodes');
  const minimapViewport = document.querySelector('.minimap-viewport');
  if (!minimap || !minimapNodes || !minimapViewport || !planCanvas) return;

  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;
  if (contentWidth === 0 || contentHeight === 0) return;

  const minimapRect = minimap.getBoundingClientRect();
  const canvasRect = planCanvas.getBoundingClientRect();
  const padding = 8;
  const availWidth = minimapRect.width - padding * 2;
  const availHeight = minimapRect.height - padding * 2;

  // Calculate minimap scale
  const scale = Math.min(availWidth / contentWidth, availHeight / contentHeight);

  // Render minimap nodes (only if positions changed)
  const nodeHash = JSON.stringify(currentNodePositions);
  if (minimapNodes.dataset.hash !== nodeHash) {
    let nodesHtml = '';
    for (const [id, pos] of Object.entries(currentNodePositions)) {
      const nodeClass = pos.nodeClass || 'other';
      nodesHtml += `<div class="minimap-node ${nodeClass}" style="left:${(pos.x * scale) + padding}px;top:${(pos.y * scale) + padding}px;"></div>`;
    }
    minimapNodes.innerHTML = nodesHtml;
    minimapNodes.dataset.hash = nodeHash;
  }

  // Calculate viewport rectangle position
  const viewportWidth = canvasRect.width / camera.zoom;
  const viewportHeight = canvasRect.height / camera.zoom;

  const vpLeft = (camera.x * scale) + padding;
  const vpTop = (camera.y * scale) + padding;
  const vpWidth = viewportWidth * scale;
  const vpHeight = viewportHeight * scale;

  minimapViewport.style.left = `${vpLeft}px`;
  minimapViewport.style.top = `${vpTop}px`;
  minimapViewport.style.width = `${vpWidth}px`;
  minimapViewport.style.height = `${vpHeight}px`;
}

/**
 * Setup viewport event handlers
 */
function setupViewport() {
  if (!planCanvas) return;

  // Cleanup previous listeners
  if (planCanvas._viewportCleanup) {
    planCanvas._viewportCleanup();
  }

  // Wheel/pinch: zoom in/out
  const handleWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = planCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Get world position BEFORE zoom
    const worldX = camera.x + mouseX / camera.zoom;
    const worldY = camera.y + mouseY / camera.zoom;

    // Apply zoom (1% per tick for smooth trackpad scrolling)
    const zoomDelta = e.deltaY > 0 ? 0.99 : 1.01;
    camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * zoomDelta));

    // Adjust camera so world point stays under cursor
    camera.x = worldX - mouseX / camera.zoom;
    camera.y = worldY - mouseY / camera.zoom;

    clampCameraToBounds();
    updateTransform();
  };

  // Pointer down - start pan (left-click or right-click)
  const handlePointerDown = (e) => {
    // Don't pan if clicking on a node with metrics (let it handle the click)
    if (e.target.closest('.plan-node.has-metrics')) {
      return;
    }

    // Allow panning with left-click (button 0) or right-click (button 2)
    if (e.button === 0 || e.button === 2) {
      e.preventDefault();
      viewportState.isPanning = true;
      viewportState.pointerId = e.pointerId;
      viewportState.startX = e.clientX;
      viewportState.startY = e.clientY;
      viewportState.startCameraX = camera.x;
      viewportState.startCameraY = camera.y;

      planCanvas.classList.add('panning');
      planCanvas.setPointerCapture(e.pointerId);
    }
  };

  // Pointer move - continue pan
  const handlePointerMove = (e) => {
    if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
      const dx = e.clientX - viewportState.startX;
      const dy = e.clientY - viewportState.startY;

      // Direct 1:1 panning - move canvas by the drag distance
      camera.x = viewportState.startCameraX - dx / camera.zoom;
      camera.y = viewportState.startCameraY - dy / camera.zoom;

      clampCameraToBounds();
      updateTransform();
    }
  };

  // Pointer up - end pan
  const handlePointerUp = (e) => {
    if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
      viewportState.isPanning = false;
      viewportState.pointerId = null;
      planCanvas.classList.remove('panning');
      planCanvas.releasePointerCapture(e.pointerId);
    }
  };

  // Double-click to fit
  const handleDblClick = () => fitToView(true);

  // Context menu - prevent default
  const handleContextMenu = (e) => e.preventDefault();

  // Keyboard handlers
  const handleKeyDown = (e) => {
    // Only handle if plan tab is visible and not in input
    if (!planContainer || planContainer.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomToCenter(ZOOM_STEP, true);
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomToCenter(1 / ZOOM_STEP, true);
        break;
      case '0':
      case 'f':
      case 'F':
        e.preventDefault();
        fitToView(true);
        break;
      case 'Home':
        e.preventDefault();
        camera.x = 0;
        camera.y = 0;
        clampCameraToBounds();
        updateTransform(true);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        panBy(PAN_STEP, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        panBy(-PAN_STEP, 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        panBy(0, PAN_STEP);
        break;
      case 'ArrowDown':
        e.preventDefault();
        panBy(0, -PAN_STEP);
        break;
    }
  };

  const handleKeyUp = () => {
    // Reserved for future keyboard interactions
  };

  // Minimap click to navigate
  const minimap = document.querySelector('.viewport-minimap');
  const handleMinimapClick = (e) => {
    if (!minimap) return;

    const minimapRect = minimap.getBoundingClientRect();
    const canvasRect = planCanvas.getBoundingClientRect();
    const padding = 8;
    const availWidth = minimapRect.width - padding * 2;
    const availHeight = minimapRect.height - padding * 2;

    const scale = Math.min(
      availWidth / currentContentSize.width,
      availHeight / currentContentSize.height
    );

    // Click position to world coordinates
    const clickX = (e.clientX - minimapRect.left - padding) / scale;
    const clickY = (e.clientY - minimapRect.top - padding) / scale;

    // Center camera on clicked point
    camera.x = clickX - (canvasRect.width / camera.zoom) / 2;
    camera.y = clickY - (canvasRect.height / camera.zoom) / 2;

    clampCameraToBounds();
    updateTransform(true);
  };

  // Attach event listeners
  planCanvas.addEventListener('wheel', handleWheel, { passive: false });
  planCanvas.addEventListener('pointerdown', handlePointerDown);
  planCanvas.addEventListener('pointermove', handlePointerMove);
  planCanvas.addEventListener('pointerup', handlePointerUp);
  planCanvas.addEventListener('dblclick', handleDblClick);
  planCanvas.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  minimap?.addEventListener('click', handleMinimapClick);

  // Slowest panel toggle buttons
  const toggleSlowestBtn = document.getElementById('toggleSlowestPanel');
  const panelCloseBtn = document.getElementById('slowestPanelToggle');
  toggleSlowestBtn?.addEventListener('click', toggleSlowestPanel);
  panelCloseBtn?.addEventListener('click', toggleSlowestPanel);

  // Store cleanup function
  planCanvas._viewportCleanup = () => {
    planCanvas.removeEventListener('wheel', handleWheel);
    planCanvas.removeEventListener('pointerdown', handlePointerDown);
    planCanvas.removeEventListener('pointermove', handlePointerMove);
    planCanvas.removeEventListener('pointerup', handlePointerUp);
    planCanvas.removeEventListener('dblclick', handleDblClick);
    planCanvas.removeEventListener('contextmenu', handleContextMenu);
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    minimap?.removeEventListener('click', handleMinimapClick);
    toggleSlowestBtn?.removeEventListener('click', toggleSlowestPanel);
    panelCloseBtn?.removeEventListener('click', toggleSlowestPanel);
  };
}

/**
 * Cleanup viewport state
 */
function cleanupViewport() {
  if (planCanvas?._viewportCleanup) {
    planCanvas._viewportCleanup();
    delete planCanvas._viewportCleanup;
  }
  camera = { x: 0, y: 0, zoom: 1 };
  viewportState = {
    isPanning: false,
    isSpacePressed: false,
    startX: 0,
    startY: 0,
    startCameraX: 0,
    startCameraY: 0,
    pointerId: null
  };
  currentContentSize = { width: 0, height: 0 };
  currentNodePositions = {};

  // Clear filter state
  currentGraph = null;
  currentRootId = null;
  currentParentMap = null;

  // Hide UI
  document.querySelector('.canvas-toolbar')?.classList.remove('visible');
  document.querySelector('.viewport-minimap')?.classList.remove('visible');
  document.querySelector('.plan-search-bar')?.classList.remove('visible');

  // Reset cursor
  planCanvas?.classList.remove('panning');
}

/**
 * Load plan file
 */
function loadPlanFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // Validate it's a query profile
      if (!data.Query) {
        alert('Invalid query profile format - missing "Query" field');
        return;
      }

      // Update global state (will trigger all tabs to update)
      setQuery(data);

      trackEvent('upload-plan');
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
 * Looks through all instances to find the primary SCAN operator (OLAP_SCAN or CONNECTOR_SCAN)
 * Excludes auxiliary operators like OLAP_SCAN_PREPARE, CHUNK_ACCUMULATE, etc.
 */
function getScanMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }

  let scanInstance = null;

  // Priority 1: Find exact OLAP_SCAN or CONNECTOR_SCAN (primary scan operators with full metrics)
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName;
    if (opName === 'OLAP_SCAN' || opName === 'CONNECTOR_SCAN') {
      scanInstance = inst.metrics;
      break;
    }
  }

  // Priority 2: Any operator containing SCAN as fallback (for unknown scan variants)
  if (!scanInstance) {
    for (const inst of metricsData.instances) {
      if (inst.operatorName.toUpperCase().includes('SCAN')) {
        scanInstance = inst.metrics;
        break;
      }
    }
  }

  // Priority 3: First instance as final fallback
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

  // Store graph reference for filtering
  currentGraph = graph;
  currentRootId = rootId;
  currentParentMap = null;  // Reset parent map cache

  const root = graph[rootId];
  if (!root) {
    alert('Could not find root node in topology');
    return;
  }

  const layout = calculateTreeLayout(root, graph);
  renderTreeWithSVG(layout, graph);

  // Calculate and display slowest operators
  rankedOperators = calculateOperatorRankings(graph);
  renderSlowestPanel(rankedOperators);
  applySlowestHighlights(rankedOperators);

  planDropZone.style.display = 'none';
  planContainer.style.display = 'block';

  // Initialize viewport and fit content to view
  setupViewport();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitToView(false));
  });

  // Show UI elements
  document.querySelector('.canvas-toolbar')?.classList.add('visible');
  document.querySelector('.viewport-minimap')?.classList.add('visible');
  document.querySelector('.plan-search-bar')?.classList.add('visible');

  // Clear any previous filter
  clearFilter();
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
 * Check if node is a join operator
 */
function isJoinOperator(name) {
  return name.toUpperCase().includes('JOIN');
}

/**
 * Check if node is an exchange operator
 */
function isExchangeOperator(name) {
  const n = name.toUpperCase();
  return n === 'EXCHANGE' || n.includes('EXCHANGE');
}

/**
 * Parse time string to microseconds for calculations
 */
function parseTimeToMicroseconds(timeStr) {
  if (!timeStr || timeStr === 'N/A') return 0;
  
  const str = String(timeStr).toLowerCase();
  const value = parseFloat(str);
  if (isNaN(value)) return 0;
  
  if (str.includes('ms')) return value * 1000;
  if (str.includes('us')) return value;
  if (str.includes('ns')) return value / 1000;
  if (str.includes('s') && !str.includes('us') && !str.includes('ns') && !str.includes('ms')) return value * 1000000;
  
  return value;
}

/**
 * Format microseconds to human readable time
 */
function formatMicroseconds(us) {
  if (us >= 1000000) return (us / 1000000).toFixed(2) + 's';
  if (us >= 1000) return (us / 1000).toFixed(2) + 'ms';
  if (us >= 1) return us.toFixed(2) + 'us';
  return (us * 1000).toFixed(0) + 'ns';
}

/**
 * Get aggregated metrics for a join operator
 * Finds HASH_JOIN_PROBE and HASH_JOIN_BUILD instances
 */
function getJoinMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  let probeInstance = null;
  let buildInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName.includes('JOIN_PROBE')) {
      probeInstance = inst.metrics;
    } else if (opName.includes('JOIN_BUILD')) {
      buildInstance = inst.metrics;
    }
  }
  
  // Need at least one of probe or build
  if (!probeInstance && !buildInstance) {
    return null;
  }
  
  const probeCommon = probeInstance?.CommonMetrics || {};
  const probeUnique = probeInstance?.UniqueMetrics || {};
  const buildCommon = buildInstance?.CommonMetrics || {};
  const buildUnique = buildInstance?.UniqueMetrics || {};
  
  // Extract times
  const buildTime = buildCommon.OperatorTotalTime || 'N/A';
  const probeTime = probeCommon.OperatorTotalTime || 'N/A';
  
  // Calculate total join time
  const buildUs = parseTimeToMicroseconds(buildTime);
  const probeUs = parseTimeToMicroseconds(probeTime);
  const totalUs = buildUs + probeUs;
  const totalTime = totalUs > 0 ? formatMicroseconds(totalUs) : 'N/A';
  
  return {
    joinType: probeUnique.JoinType || buildUnique.JoinType || 'N/A',
    distributionMode: probeUnique.DistributionMode || buildUnique.DistributionMode || 'N/A',
    joinPredicates: buildUnique.JoinPredicates || 'N/A',
    buildTime: buildTime,
    probeTime: probeTime,
    totalJoinTime: totalTime,
    buildHashTableTime: buildUnique.BuildHashTableTime || 'N/A',
    searchHashTableTime: probeUnique.SearchHashTableTime || 'N/A',
    hashTableMemory: buildUnique.HashTableMemoryUsage || 'N/A',
    pullRowNum: probeCommon.PullRowNum || '0',
    buildRows: buildCommon.PushRowNum || '0'
  };
}

/**
 * Get aggregated metrics for an exchange operator
 * Finds EXCHANGE_SOURCE and EXCHANGE_SINK instances
 */
function getExchangeMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  let sourceInstance = null;
  let sinkInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName === 'EXCHANGE_SOURCE') {
      sourceInstance = inst.metrics;
    } else if (opName === 'EXCHANGE_SINK') {
      sinkInstance = inst.metrics;
    }
  }
  
  // Need at least one of source or sink
  if (!sourceInstance && !sinkInstance) {
    return null;
  }
  
  const sourceCommon = sourceInstance?.CommonMetrics || {};
  const sourceUnique = sourceInstance?.UniqueMetrics || {};
  const sinkCommon = sinkInstance?.CommonMetrics || {};
  const sinkUnique = sinkInstance?.UniqueMetrics || {};
  
  // Extract times
  const sourceTime = sourceCommon.OperatorTotalTime || '0';
  const sinkTime = sinkCommon.OperatorTotalTime || '0';
  const networkTime = sinkUnique.NetworkTime || '0';
  
  // Calculate totals in microseconds
  const sourceUs = parseTimeToMicroseconds(sourceTime);
  const sinkUs = parseTimeToMicroseconds(sinkTime);
  const networkUs = parseTimeToMicroseconds(networkTime);
  const cpuUs = sourceUs + sinkUs;
  const totalUs = cpuUs + networkUs;
  
  // Calculate percentages
  const cpuPercent = totalUs > 0 ? Math.round((cpuUs / totalUs) * 100) : 0;
  const networkPercent = totalUs > 0 ? Math.round((networkUs / totalUs) * 100) : 0;
  
  return {
    partType: sinkUnique.PartType || 'N/A',
    totalTime: totalUs > 0 ? formatMicroseconds(totalUs) : 'N/A',
    cpuTime: cpuUs > 0 ? formatMicroseconds(cpuUs) : 'N/A',
    cpuPercent: cpuPercent,
    networkTime: networkUs > 0 ? formatMicroseconds(networkUs) : 'N/A',
    networkPercent: networkPercent,
    sourceTime: sourceTime,
    sinkTime: sinkTime,
    bytesSent: sinkUnique.BytesSent || 'N/A',
    bytesReceived: sourceUnique.BytesReceived || 'N/A',
    pullRowNum: sourceCommon.PullRowNum || '0',
    networkBandwidth: sinkUnique.NetworkBandwidth || 'N/A'
  };
}

/**
 * Calculate total time for a node based on all its operators
 * Rules:
 * - SCAN: OperatorTotalTime + ScanTime
 * - EXCHANGE: OperatorTotalTime (source + sink) + NetworkTime
 * - JOIN: OperatorTotalTime (probe + build)
 * - Others: OperatorTotalTime
 */
function getNodeTotalTime(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }

  let totalUs = 0;

  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    const common = inst.metrics?.CommonMetrics || {};
    const unique = inst.metrics?.UniqueMetrics || {};

    // Add OperatorTotalTime for all operators
    if (common.OperatorTotalTime) {
      totalUs += parseTimeToMicroseconds(common.OperatorTotalTime);
    }

    // Add ScanTime for SCAN operators
    if (opName.includes('SCAN') && unique.ScanTime) {
      totalUs += parseTimeToMicroseconds(unique.ScanTime);
    }

    // Add NetworkTime for EXCHANGE_SINK operators
    if (opName === 'EXCHANGE_SINK' && unique.NetworkTime) {
      totalUs += parseTimeToMicroseconds(unique.NetworkTime);
    }
  }

  return totalUs > 0 ? formatMicroseconds(totalUs) : null;
}

/**
 * Calculate operator rankings by total time
 * Returns array of operators sorted by time descending
 */
function calculateOperatorRankings(graph) {
  const operators = [];

  for (const [id, node] of Object.entries(graph)) {
    if (!node.metrics) continue;

    const timeStr = getNodeTotalTime(node.metrics);
    if (!timeStr) continue;

    const timeMicros = parseTimeToMicroseconds(timeStr);

    if (timeMicros > 0) {
      operators.push({
        id: id,
        name: node.name,
        timeStr: timeStr,
        timeMicros: timeMicros
      });
    }
  }

  // Sort descending by time
  operators.sort((a, b) => b.timeMicros - a.timeMicros);
  return operators;
}

/**
 * Render the slowest operators panel content
 */
function renderSlowestPanel(operators) {
  const content = document.getElementById('slowestPanelContent');
  if (!content) return;

  if (operators.length === 0) {
    content.innerHTML = '<div style="padding: 16px; color: var(--text-secondary); font-size: 0.7rem;">No timing data available</div>';
    return;
  }

  // Show top 10
  const top10 = operators.slice(0, 10);
  const maxTime = top10[0]?.timeMicros || 1;

  content.innerHTML = top10.map((op, idx) => {
    const rank = idx + 1;
    const rankClass = rank === 1 ? 'top1' : rank <= 5 ? 'top5' : 'other';
    const rowClass = rank === 1 ? 'top1-row' : rank <= 5 ? 'top5-row' : '';
    const barWidth = Math.round((op.timeMicros / maxTime) * 100);

    // Shorten operator names for display
    const shortName = op.name
      .replace(/_/g, ' ')
      .replace(/CONNECTOR /gi, '')
      .replace(/HASH /gi, '');

    return `
      <div class="slowest-row ${rowClass}" data-node-id="${op.id}">
        <span class="slowest-rank ${rankClass}">#${rank}</span>
        <span class="slowest-name" title="${op.name}">${shortName}</span>
        <span class="slowest-node-id">${op.id}</span>
        <div class="slowest-time-bar"><div class="slowest-time-bar-fill" style="width: ${barWidth}%"></div></div>
        <span class="slowest-time">${op.timeStr}</span>
      </div>
    `;
  }).join('');

  // Add click handlers to navigate to nodes
  content.querySelectorAll('.slowest-row').forEach(row => {
    row.addEventListener('click', () => {
      const nodeId = row.dataset.nodeId;
      zoomToNode(nodeId);
    });
  });
}

/**
 * Apply highlight classes to the slowest nodes in the plan
 */
function applySlowestHighlights(operators) {
  // Clear existing highlights
  document.querySelectorAll('.plan-node.slowest-top1, .plan-node.slowest-top5')
    .forEach(el => el.classList.remove('slowest-top1', 'slowest-top5'));

  // Apply new highlights to top 5
  operators.slice(0, 5).forEach((op, idx) => {
    const nodeEl = document.getElementById(`node-${op.id}`);
    if (nodeEl) {
      nodeEl.classList.add(idx === 0 ? 'slowest-top1' : 'slowest-top5');
    }
  });
}

/**
 * Toggle the slowest operators panel visibility
 */
function toggleSlowestPanel() {
  const panel = document.getElementById('slowestPanel');
  if (!panel) return;

  slowestPanelVisible = !slowestPanelVisible;
  panel.classList.toggle('collapsed', !slowestPanelVisible);

  // Update toolbar button state
  const toggleBtn = document.getElementById('toggleSlowestPanel');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', slowestPanelVisible);
  }
}

// Expose toggle function globally for the panel close button
window.toggleSlowestPanel = toggleSlowestPanel;

/**
 * Get row count (PullRowNum) from a node's metrics
 * Returns formatted string or null if not available
 * Prioritizes SOURCE operators since SINK operators typically have PullRowNum=0
 */
function getNodeRowCount(node) {
  if (!node || !node.metrics || !node.metrics.instances) return null;

  // Priority 1: Find a SOURCE operator with non-zero PullRowNum
  // (ANALYTIC_SOURCE, EXCHANGE_SOURCE, etc. are where rows are pulled from)
  for (const inst of node.metrics.instances) {
    const opName = inst.operatorName?.toUpperCase() || '';
    if (opName.includes('SOURCE')) {
      const common = inst.metrics?.CommonMetrics;
      if (common && common.PullRowNum && common.PullRowNum !== '0') {
        return formatRowCount(common.PullRowNum);
      }
    }
  }

  // Priority 2: Find any operator with non-zero PullRowNum
  for (const inst of node.metrics.instances) {
    const common = inst.metrics?.CommonMetrics;
    if (common && common.PullRowNum && common.PullRowNum !== '0') {
      return formatRowCount(common.PullRowNum);
    }
  }

  // Priority 3: Return first PullRowNum found (even if "0")
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
 * Parse PullRowNum string to numeric value
 * Handles formats like "207.615K (207615)" or plain numbers
 */
function parsePullRowNum(rawValue) {
  if (!rawValue || rawValue === '0') return 0;

  const str = String(rawValue);
  // Try to extract number from parentheses first (e.g., "207.615K (207615)")
  const parenMatch = str.match(/\((\d+)\)/);
  if (parenMatch) return parseInt(parenMatch[1], 10);

  // Otherwise parse the value directly
  const num = parseFloat(str.replace(/[,\s]/g, ''));
  if (isNaN(num)) return 0;

  // Handle K/M/B suffixes
  if (str.toUpperCase().includes('B')) return num * 1000000000;
  if (str.toUpperCase().includes('M')) return num * 1000000;
  if (str.toUpperCase().includes('K')) return num * 1000;
  return num;
}

/**
 * Get raw numeric row count from a node
 * Prioritizes SOURCE operators since SINK operators typically have PullRowNum=0
 */
function getNodeRowCountNumeric(node) {
  if (!node || !node.metrics || !node.metrics.instances) return 0;

  // Priority 1: Find a SOURCE operator with non-zero PullRowNum
  for (const inst of node.metrics.instances) {
    const opName = inst.operatorName?.toUpperCase() || '';
    if (opName.includes('SOURCE')) {
      const common = inst.metrics?.CommonMetrics;
      if (common && common.PullRowNum) {
        const value = parsePullRowNum(common.PullRowNum);
        if (value > 0) return value;
      }
    }
  }

  // Priority 2: Find any operator with non-zero PullRowNum
  for (const inst of node.metrics.instances) {
    const common = inst.metrics?.CommonMetrics;
    if (common && common.PullRowNum) {
      const value = parsePullRowNum(common.PullRowNum);
      if (value > 0) return value;
    }
  }

  return 0;
}

/**
 * Calculate edge stroke width based on row count
 * Uses logarithmic scale: more rows = thicker edge
 * Range: 1.5px (minimum) to 8px (maximum)
 */
function calculateEdgeWidth(rowCount) {
  const MIN_WIDTH = 1.5;
  const MAX_WIDTH = 8;

  if (!rowCount || rowCount <= 0) return MIN_WIDTH;

  // Use log10 scale: 1 row = 0, 10 rows = 1, 100 = 2, 1K = 3, 10K = 4, 100K = 5, 1M = 6, 10M = 7
  const logValue = Math.log10(Math.max(1, rowCount));

  // Map log scale (0-7) to width range
  // 0 (1 row) -> MIN_WIDTH
  // 7 (10M rows) -> MAX_WIDTH
  const normalized = Math.min(logValue / 7, 1);
  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * normalized;
}

/**
 * Build metrics dropdown HTML for scan nodes
 */
function buildScanMetricsDropdown(node) {
  const m = getScanMetrics(node.metrics);
  if (!m) return '';

  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;">
      <div class="metric-row"><span class="metric-label">Table</span><span class="metric-value">${m.table}</span></div>
      <div class="metric-row"><span class="metric-label">Operator Time</span><span class="metric-value time">${m.operatorTotalTime}</span></div>
      <div class="metric-row"><span class="metric-label">Scan Time</span><span class="metric-value time">${m.scanTime}</span></div>
      <div class="metric-row"><span class="metric-label">Bytes Read</span><span class="metric-value bytes">${m.bytesRead}</span></div>
      <div class="metric-row"><span class="metric-label">Pull Rows</span><span class="metric-value rows">${m.pullRowNum}</span></div>
      <div class="metric-row"><span class="metric-label">Rows Read</span><span class="metric-value rows">${m.rowsRead}</span></div>
      <div class="metric-row"><span class="metric-label">Raw Rows Read</span><span class="metric-value rows">${m.rawRowsRead}</span></div>
      <div class="metric-row" style="border-bottom:none;"><span class="metric-label">Tablets</span><span class="metric-value">${m.tabletCount}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML for join nodes
 */
function buildJoinMetricsDropdown(node) {
  const m = getJoinMetrics(node.metrics);
  if (!m) return '';

  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;">
      <div class="metric-row"><span class="metric-label">Join Type</span><span class="metric-value type">${m.joinType}</span></div>
      <div class="metric-row"><span class="metric-label">Distribution</span><span class="metric-value">${m.distributionMode}</span></div>
      <div class="metric-row"><span class="metric-label">Predicates</span><span class="metric-value">${m.joinPredicates}</span></div>
      <div class="metric-row"><span class="metric-label">Total Join Time</span><span class="metric-value time">${m.totalJoinTime}</span></div>
      <div class="metric-row"><span class="metric-label">Build Time</span><span class="metric-value time">${m.buildTime}</span></div>
      <div class="metric-row"><span class="metric-label">Probe Time</span><span class="metric-value time">${m.probeTime}</span></div>
      <div class="metric-row"><span class="metric-label">Build Hash Table</span><span class="metric-value time">${m.buildHashTableTime}</span></div>
      <div class="metric-row"><span class="metric-label">Search Hash Table</span><span class="metric-value time">${m.searchHashTableTime}</span></div>
      <div class="metric-row"><span class="metric-label">Hash Table Memory</span><span class="metric-value memory">${m.hashTableMemory}</span></div>
      <div class="metric-row"><span class="metric-label">Build Rows</span><span class="metric-value rows">${m.buildRows}</span></div>
      <div class="metric-row" style="border-bottom:none;"><span class="metric-label">Output Rows</span><span class="metric-value rows">${m.pullRowNum}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML for exchange nodes
 */
function buildExchangeMetricsDropdown(node) {
  const m = getExchangeMetrics(node.metrics);
  if (!m) return '';

  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;">
      <div class="metric-row"><span class="metric-label">Partition Type</span><span class="metric-value">${m.partType}</span></div>
      <div class="metric-row"><span class="metric-label">Total Time</span><span class="metric-value time">${m.totalTime}</span></div>
      <div class="metric-row"><span class="metric-label">CPU Time</span><span class="metric-value time">${m.cpuTime} <span class="metric-percent">(${m.cpuPercent}%)</span></span></div>
      <div class="metric-row"><span class="metric-label">Network Time</span><span class="metric-value network">${m.networkTime} <span class="metric-percent">(${m.networkPercent}%)</span></span></div>
      <div class="metric-row"><span class="metric-label">Source Time</span><span class="metric-value time">${m.sourceTime}</span></div>
      <div class="metric-row"><span class="metric-label">Sink Time</span><span class="metric-value time">${m.sinkTime}</span></div>
      <div class="metric-row"><span class="metric-label">Bytes Sent</span><span class="metric-value bytes">${m.bytesSent}</span></div>
      <div class="metric-row"><span class="metric-label">Bytes Received</span><span class="metric-value bytes">${m.bytesReceived}</span></div>
      <div class="metric-row"><span class="metric-label">Bandwidth</span><span class="metric-value bytes">${m.networkBandwidth}</span></div>
      <div class="metric-row" style="border-bottom:none;"><span class="metric-label">Rows</span><span class="metric-value rows">${m.pullRowNum}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML based on node type
 */
function buildMetricsDropdown(node) {
  if (!node.metrics) return '';
  
  if (isScanOperator(node.name)) {
    return buildScanMetricsDropdown(node);
  }
  
  if (isJoinOperator(node.name)) {
    return buildJoinMetricsDropdown(node);
  }
  
  if (isExchangeOperator(node.name)) {
    return buildExchangeMetricsDropdown(node);
  }
  
  return '';
}

/**
 * Check if node has expandable metrics
 */
function hasExpandableMetrics(node) {
  if (!node.metrics) return false;
  return isScanOperator(node.name) || isJoinOperator(node.name) || isExchangeOperator(node.name);
}

// ========================================
// Filter Functions
// ========================================

/**
 * Parse a single selector (node, type, or table filter)
 * @param {string} part - A single selector like "node=5", "type=scan", or "table=orders"
 * @returns {Object|null} - { selectorType: 'node'|'type'|'table', ... } or null if invalid
 */
function parseSelector(part) {
  // Type filter: type=scan, type=join, type=exchange
  const typeMatch = part.match(/^type=(\w+)$/i);
  if (typeMatch) {
    const validTypes = ['scan', 'join', 'exchange', 'aggregate', 'project', 'union'];
    const type = typeMatch[1].toLowerCase();
    if (validTypes.includes(type)) {
      return { selectorType: 'type', typeFilter: type };
    }
    return null;
  }

  // Table filter: table=orders, table=customer (case-insensitive exact match)
  const tableMatch = part.match(/^table=(.+)$/i);
  if (tableMatch) {
    const tableName = tableMatch[1].trim();
    if (tableName) {
      return { selectorType: 'table', tableFilter: tableName.toLowerCase() };
    }
    return null;
  }

  // Node selector: +node=1+, node=1, +node=1, node=1+
  const nodeMatch = part.match(/^(\+)?node=(\d+)(\+)?$/i);
  if (nodeMatch) {
    const nodeId = parseInt(nodeMatch[2]);
    if (!isNaN(nodeId) && nodeId >= 0) {
      return {
        selectorType: 'node',
        nodeId,
        upstream: !!nodeMatch[1],
        downstream: !!nodeMatch[3]
      };
    }
  }

  return null;
}

/**
 * Parse a filter query string into a structured specification
 * Syntax:
 *   node=N        - single node
 *   +node=N       - node + ancestors (upstream)
 *   node=N+       - node + descendants (downstream)
 *   +node=N+      - node + full lineage
 *   type=scan     - all scan operators
 *   type=join     - all join operators
 *   type=exchange - all exchange operators
 *   table=name    - scan operators matching table name (case-insensitive exact match)
 *   --hide        - hide non-matching (default: dim)
 *
 * Operators:
 *   , or "or"     - OR (union)
 *   & or "and"    - AND (intersection), binds tighter than OR
 *
 * Examples:
 *   node=5+ & type=scan     - descendants of 5 that are scans
 *   node=5, type=join       - node 5 OR any join
 *   node=5+ & type=scan, type=join  - (descendants of 5 that are scans) OR any join
 *   table=orders            - all scans on the "orders" table
 *   table=customer & node=5+ - scans matching "customer" that are descendants of node 5
 *
 * @param {string} query - The filter query
 * @returns {Object} - { orGroups: [...], hideMode: boolean }
 */
function parseFilterQuery(query) {
  if (!query || !query.trim()) {
    return { orGroups: [], hideMode: false };
  }

  let hideMode = false;

  // Check for --hide modifier
  if (query.includes('--hide')) {
    hideMode = true;
    query = query.replace(/--hide/g, '').trim();
  }

  // Split by OR operators: comma or "or" (with word boundaries)
  // But preserve "and" and "&" within groups
  const orParts = query.split(/\s*(?:,|\bor\b)\s*/i).filter(Boolean);

  const orGroups = [];

  for (const orPart of orParts) {
    // Split by AND operators: & or "and"
    const andParts = orPart.split(/\s*(?:&|\band\b)\s*/i).filter(Boolean);

    const group = {
      nodeSelectors: [],
      typeFilters: [],
      tableFilters: []
    };

    for (const part of andParts) {
      const selector = parseSelector(part.trim());
      if (selector) {
        if (selector.selectorType === 'node') {
          group.nodeSelectors.push(selector);
        } else if (selector.selectorType === 'type') {
          group.typeFilters.push(selector.typeFilter);
        } else if (selector.selectorType === 'table') {
          group.tableFilters.push(selector.tableFilter);
        }
      }
    }

    // Only add non-empty groups
    if (group.nodeSelectors.length > 0 || group.typeFilters.length > 0 || group.tableFilters.length > 0) {
      orGroups.push(group);
    }
  }

  return { orGroups, hideMode };
}

/**
 * Build a parent map from the graph (child -> parent)
 * @param {Object} graph - The graph object with nodes
 * @param {number} rootId - The root node ID
 * @returns {Map<number, number>} - Map of childId -> parentId
 */
function buildParentMap(graph, rootId) {
  const parentMap = new Map();
  const visited = new Set();

  function traverse(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = graph[nodeId];
    if (!node || !node.children) return;

    for (const childId of node.children) {
      parentMap.set(childId, nodeId);
      traverse(childId);
    }
  }

  traverse(rootId);
  return parentMap;
}

/**
 * Get all upstream (ancestor) nodes for a given node
 * @param {number} nodeId - Starting node ID
 * @param {Map<number, number>} parentMap - Parent mapping
 * @returns {Set<number>} - Set of ancestor node IDs (includes the node itself)
 */
function getUpstreamNodes(nodeId, parentMap) {
  const upstream = new Set([nodeId]);
  let currentId = nodeId;

  while (parentMap.has(currentId)) {
    currentId = parentMap.get(currentId);
    upstream.add(currentId);
  }

  return upstream;
}

/**
 * Get all downstream (descendant) nodes for a given node
 * @param {number} nodeId - Starting node ID
 * @param {Object} graph - The graph object
 * @returns {Set<number>} - Set of descendant node IDs (includes the node itself)
 */
function getDownstreamNodes(nodeId, graph) {
  const downstream = new Set();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (downstream.has(currentId)) continue;
    downstream.add(currentId);

    const node = graph[currentId];
    if (node && node.children) {
      queue.push(...node.children);
    }
  }

  return downstream;
}

/**
 * Get nodes matching a single node selector
 * @param {Object} selector - { nodeId, upstream, downstream }
 * @returns {Set<number>} - Set of matching node IDs
 */
function getNodesForSelector(selector) {
  const nodes = new Set();

  if (!currentGraph[selector.nodeId]) return nodes;

  nodes.add(selector.nodeId);

  if (selector.upstream && currentParentMap) {
    const upstream = getUpstreamNodes(selector.nodeId, currentParentMap);
    upstream.forEach(id => nodes.add(id));
  }

  if (selector.downstream) {
    const downstream = getDownstreamNodes(selector.nodeId, currentGraph);
    downstream.forEach(id => nodes.add(id));
  }

  return nodes;
}

/**
 * Get nodes matching a type filter
 * @param {string} typeFilter - 'scan', 'join', etc.
 * @returns {Set<number>} - Set of matching node IDs
 */
function getNodesForType(typeFilter) {
  const nodes = new Set();

  for (const [id, node] of Object.entries(currentGraph)) {
    const nodeType = getNodeClass(node.name);
    if (nodeType === typeFilter) {
      nodes.add(parseInt(id));
    }
  }

  return nodes;
}

/**
 * Get nodes matching a table filter (scan operators only)
 * @param {string} tableFilter - Table name to match (case-insensitive exact match)
 * @returns {Set<number>} - Set of matching node IDs
 */
function getNodesForTable(tableFilter) {
  const nodes = new Set();
  const searchTerm = tableFilter.toLowerCase();

  for (const [id, node] of Object.entries(currentGraph)) {
    // Only scan operators have table names
    if (!isScanOperator(node.name)) continue;
    if (!node.metrics) continue;

    const scanMetrics = getScanMetrics(node.metrics);
    if (!scanMetrics || !scanMetrics.table || scanMetrics.table === 'N/A') continue;

    // Case-insensitive exact match
    const tableName = scanMetrics.table.toLowerCase();
    if (tableName === searchTerm) {
      nodes.add(parseInt(id));
    }
  }

  return nodes;
}

/**
 * Compute intersection of two sets
 */
function setIntersection(setA, setB) {
  const result = new Set();
  for (const item of setA) {
    if (setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

/**
 * Compute union of two sets
 */
function setUnion(setA, setB) {
  const result = new Set(setA);
  for (const item of setB) {
    result.add(item);
  }
  return result;
}

/**
 * Apply filter to the current graph visualization
 * @param {string} query - The filter query string
 * @returns {Set<number>|null} - Set of matching node IDs, or null if no filter
 */
function applyFilter(query) {
  if (!currentGraph || !planCanvas) return null;

  const spec = parseFilterQuery(query);

  // If no filter criteria, just reset visuals (don't clear input)
  if (spec.orGroups.length === 0) {
    resetFilterVisuals();
    return null;
  }

  // Build parent map if not cached
  if (!currentParentMap && currentRootId !== null) {
    currentParentMap = buildParentMap(currentGraph, currentRootId);
  }

  // Process OR groups - union the results
  let matchingNodes = new Set();

  for (const group of spec.orGroups) {
    // For each AND group, compute intersection of all conditions
    let groupNodes = null;

    // Process node selectors within the AND group
    for (const selector of group.nodeSelectors) {
      const selectorNodes = getNodesForSelector(selector);
      if (groupNodes === null) {
        groupNodes = selectorNodes;
      } else {
        groupNodes = setIntersection(groupNodes, selectorNodes);
      }
    }

    // Process type filters within the AND group
    for (const typeFilter of group.typeFilters) {
      const typeNodes = getNodesForType(typeFilter);
      if (groupNodes === null) {
        groupNodes = typeNodes;
      } else {
        groupNodes = setIntersection(groupNodes, typeNodes);
      }
    }

    // Process table filters within the AND group
    for (const tableFilter of group.tableFilters) {
      const tableNodes = getNodesForTable(tableFilter);
      if (groupNodes === null) {
        groupNodes = tableNodes;
      } else {
        groupNodes = setIntersection(groupNodes, tableNodes);
      }
    }

    // Union this AND group's result with overall results
    if (groupNodes) {
      matchingNodes = setUnion(matchingNodes, groupNodes);
    }
  }

  // Apply CSS classes to nodes
  const dimClass = spec.hideMode ? 'filter-hidden' : 'filter-dimmed';

  for (const id of Object.keys(currentGraph)) {
    const nodeEl = document.getElementById(`node-${id}`);
    if (!nodeEl) continue;

    nodeEl.classList.remove('filter-dimmed', 'filter-hidden', 'filter-match');

    if (matchingNodes.has(parseInt(id))) {
      nodeEl.classList.add('filter-match');
    } else {
      nodeEl.classList.add(dimClass);
    }
  }

  // Apply CSS classes to edges
  const svg = planCanvas.querySelector('.plan-svg');
  if (svg) {
    svg.querySelectorAll('path[data-from]').forEach(path => {
      const fromId = parseInt(path.dataset.from);
      const toId = parseInt(path.dataset.to);

      path.classList.remove('filter-dimmed', 'filter-hidden');

      // Edge is visible only if both endpoints are matching
      if (matchingNodes.has(fromId) && matchingNodes.has(toId)) {
        // Keep visible
      } else {
        path.classList.add(dimClass);
      }
    });

    // Handle edge labels (rect and text with data-edge-label)
    svg.querySelectorAll('[data-edge-label]').forEach(el => {
      const [fromId, toId] = el.dataset.edgeLabel.split('-').map(Number);

      el.classList.remove('filter-dimmed', 'filter-hidden');

      if (matchingNodes.has(fromId) && matchingNodes.has(toId)) {
        // Keep visible
      } else {
        el.classList.add(dimClass);
      }
    });
  }

  // Update toggle button state if hide mode
  const hideToggle = document.getElementById('planSearchHideToggle');
  if (hideToggle) {
    if (spec.hideMode) {
      hideToggle.classList.add('hide-mode');
      hideToggle.textContent = 'hide';
    } else {
      hideToggle.classList.remove('hide-mode');
      hideToggle.textContent = 'dim';
    }
  }

  return matchingNodes;
}

/**
 * Reset filter visuals only (don't clear input)
 * Used when query is incomplete/invalid while typing
 */
function resetFilterVisuals() {
  // Clear node classes
  planCanvas?.querySelectorAll('.plan-node').forEach(node => {
    node.classList.remove('filter-dimmed', 'filter-hidden', 'filter-match');
  });

  // Clear edge classes
  planCanvas?.querySelectorAll('.plan-svg path, .plan-svg rect, .plan-svg text').forEach(el => {
    el.classList.remove('filter-dimmed', 'filter-hidden');
  });
}

/**
 * Clear all filter states including input and pills
 */
function clearFilter() {
  resetFilterVisuals();

  // Clear search input
  const searchInput = document.getElementById('planSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.style.display = '';
  }

  // Clear pills
  const pillsContainer = document.getElementById('planFilterPills');
  if (pillsContainer) pillsContainer.innerHTML = '';

  // Reset toggle button
  const hideToggle = document.getElementById('planSearchHideToggle');
  if (hideToggle) {
    hideToggle.classList.remove('hide-mode');
    hideToggle.textContent = 'dim';
  }
}

/**
 * Convert parsed filter spec to pill elements
 * @param {Object} spec - Parsed filter spec from parseFilterQuery
 * @returns {string} - HTML string for pills
 */
function renderFilterPills(spec) {
  if (!spec.orGroups || spec.orGroups.length === 0) return '';

  const pillsHtml = [];

  spec.orGroups.forEach((group, groupIndex) => {
    // Add OR operator between groups
    if (groupIndex > 0) {
      pillsHtml.push('<span class="filter-operator">,</span>');
    }

    const groupPills = [];

    // Add node selector pills
    for (const sel of group.nodeSelectors) {
      const prefix = sel.upstream ? '+' : '';
      const suffix = sel.downstream ? '+' : '';
      const label = `${prefix}node=${sel.nodeId}${suffix}`;
      groupPills.push(`<span class="filter-pill" data-selector="${label}"><span class="pill-text">${label}</span><button class="pill-remove" type="button">×</button></span>`);
    }

    // Add type filter pills
    for (const type of group.typeFilters) {
      const label = `type=${type}`;
      groupPills.push(`<span class="filter-pill" data-selector="${label}"><span class="pill-text">${label}</span><button class="pill-remove" type="button">×</button></span>`);
    }

    // Add table filter pills
    for (const table of group.tableFilters) {
      const label = `table=${table}`;
      groupPills.push(`<span class="filter-pill" data-selector="${label}"><span class="pill-text">${label}</span><button class="pill-remove" type="button">×</button></span>`);
    }

    // Join pills in this AND group with & operator
    groupPills.forEach((pill, i) => {
      if (i > 0) {
        pillsHtml.push('<span class="filter-operator">&</span>');
      }
      pillsHtml.push(pill);
    });
  });

  return pillsHtml.join('');
}

/**
 * Get current filter query from pills
 * @returns {string} - Query string reconstructed from pills
 */
function getQueryFromPills() {
  const pillsContainer = document.getElementById('planFilterPills');
  if (!pillsContainer) return '';

  const parts = [];
  let currentGroup = [];

  pillsContainer.childNodes.forEach(node => {
    if (node.classList?.contains('filter-pill')) {
      currentGroup.push(node.dataset.selector);
    } else if (node.classList?.contains('filter-operator')) {
      const op = node.textContent.trim();
      if (op === ',') {
        // OR - start new group
        if (currentGroup.length > 0) {
          parts.push(currentGroup.join(' & '));
          currentGroup = [];
        }
      }
      // & is implicit within group
    }
  });

  // Add last group
  if (currentGroup.length > 0) {
    parts.push(currentGroup.join(' & '));
  }

  return parts.join(', ');
}

/**
 * Setup plan search bar event handlers
 */
function setupPlanSearch() {
  const searchInput = document.getElementById('planSearchInput');
  const searchArea = document.getElementById('planSearchArea');
  const pillsContainer = document.getElementById('planFilterPills');
  const clearBtn = document.getElementById('planSearchClear');
  const hideToggle = document.getElementById('planSearchHideToggle');

  if (!searchInput || !pillsContainer) return;

  // Helper to get current query (from input or pills)
  const getCurrentQuery = () => {
    if (searchInput.style.display !== 'none' && searchInput.value) {
      return searchInput.value;
    }
    return getQueryFromPills();
  };

  // Helper to apply current filter and show pills
  const applyCurrentFilter = (zoomToResults = true) => {
    let query = searchInput.value.trim();
    if (!query) return;

    // Append --hide if toggle is active
    const isHideMode = hideToggle?.classList.contains('hide-mode');
    let fullQuery = query;
    if (isHideMode && !query.includes('--hide')) {
      fullQuery += ' --hide';
    }

    // Parse and apply filter
    const spec = parseFilterQuery(fullQuery);
    if (spec.orGroups.length > 0) {
      // Render pills
      pillsContainer.innerHTML = renderFilterPills(spec);
      searchInput.style.display = 'none';
      searchInput.value = query; // Keep original query without --hide

      // Apply the filter and zoom to results
      const matchingNodes = applyFilter(fullQuery);
      if (zoomToResults && matchingNodes && matchingNodes.size > 0) {
        fitToNodes(matchingNodes, true);
      }
    }
  };

  // Helper to switch to edit mode
  const switchToEditMode = () => {
    const query = getQueryFromPills();
    pillsContainer.innerHTML = '';
    searchInput.style.display = '';
    searchInput.value = query;
    searchInput.focus();
    searchInput.select();
  };

  // Apply filter on Enter key
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCurrentFilter();
      searchInput.blur();
    } else if (e.key === 'Escape') {
      clearFilter();
      searchInput.blur();
    }
  });

  // Click on search area to switch to edit mode (when pills are shown)
  searchArea?.addEventListener('click', (e) => {
    // Don't switch if clicking on a remove button
    if (e.target.classList.contains('pill-remove')) return;

    // If pills are shown, switch to edit mode
    if (pillsContainer.children.length > 0) {
      switchToEditMode();
    }
  });

  // Handle pill remove button clicks
  pillsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('pill-remove')) {
      e.stopPropagation();
      const pill = e.target.closest('.filter-pill');
      if (pill) {
        // Remove the pill
        const prevSibling = pill.previousElementSibling;
        const nextSibling = pill.nextElementSibling;

        pill.remove();

        // Clean up adjacent operator
        if (prevSibling?.classList.contains('filter-operator')) {
          prevSibling.remove();
        } else if (nextSibling?.classList.contains('filter-operator')) {
          nextSibling.remove();
        }

        // Re-apply filter with remaining pills
        const query = getQueryFromPills();
        if (query) {
          const isHideMode = hideToggle?.classList.contains('hide-mode');
          applyFilter(isHideMode ? query + ' --hide' : query);
        } else {
          // No pills left, clear filter
          clearFilter();
        }
      }
    }
  });

  // Clear button
  clearBtn?.addEventListener('click', () => {
    clearFilter();
  });

  // Hide/dim toggle
  hideToggle?.addEventListener('click', () => {
    hideToggle.classList.toggle('hide-mode');
    hideToggle.textContent = hideToggle.classList.contains('hide-mode') ? 'hide' : 'dim';

    // Reapply current filter with new mode
    const query = getCurrentQuery();
    if (query) {
      const isHideMode = hideToggle.classList.contains('hide-mode');
      applyFilter(isHideMode ? query + ' --hide' : query);
    }
  });

  // Global keyboard: "/" to focus search (when plan tab visible)
  window.addEventListener('keydown', (e) => {
    if (!planContainer || planContainer.style.display === 'none') return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === '/') {
      e.preventDefault();
      if (pillsContainer.children.length > 0) {
        switchToEditMode();
      } else {
        searchInput.focus();
        searchInput.select();
      }
    }
  });
}

/**
 * Render the tree with SVG edges
 */
function renderTreeWithSVG(layout, graph) {
  const { positions, width, height, root } = layout;
  const padding = 40;
  
  if (!root || Object.keys(positions).length === 0) {
    planCanvas.innerHTML = '<div style="padding:2rem;color:var(--danger);">No operators found</div>';
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
  
  // Render SVG edges with row count labels and weighted widths
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

      // Get row count from the child node (source of data flow)
      const childNode = graph[edge.to];
      const rowCountNumeric = getNodeRowCountNumeric(childNode);
      const rowCountFormatted = getNodeRowCount(childNode) || '0';

      // Calculate edge width based on row count (logarithmic scale)
      const strokeWidth = calculateEdgeWidth(rowCountNumeric);

      // Draw the edge path with weighted width - use CSS variable for stroke
      // Add data attributes for filtering
      edgeSvg += `<path data-from="${edge.from}" data-to="${edge.to}" d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="var(--text-secondary)" stroke-width="${strokeWidth.toFixed(1)}" stroke-linecap="round"/>`;

      if (rowCountFormatted) {
        // Calculate label position (on the bezier curve, slightly above midpoint)
        const labelX = (x1 + x2) / 2;
        const labelY = midY - 5;
        const labelWidth = rowCountFormatted.length * 7 + 12;

        // Add data-edge-label for filtering
        edgeSvg += `
          <rect data-edge-label="${edge.from}-${edge.to}" x="${labelX - labelWidth/2}" y="${labelY - 10}" width="${labelWidth}" height="18" rx="4" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1"/>
          <text data-edge-label="${edge.from}-${edge.to}" x="${labelX}" y="${labelY + 2}" text-anchor="middle" fill="var(--info)" font-size="10" font-family="JetBrains Mono, monospace">${rowCountFormatted}</text>
        `;
      }
    }
  }
  
  // Render nodes and store positions for minimap
  let nodesHtml = '';
  currentNodePositions = {};

  for (const [id, pos] of Object.entries(positions)) {
    const node = graph[id];
    if (!node) continue;

    const nodeClass = getNodeClass(node.name);
    const displayName = node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name;
    const hasMetrics = hasExpandableMetrics(node);
    const metricsDropdown = buildMetricsDropdown(node);
    const totalTime = node.metrics ? getNodeTotalTime(node.metrics) : null;

    // Store position for minimap
    currentNodePositions[id] = {
      x: pos.x + padding,
      y: pos.y + padding,
      nodeClass: nodeClass || 'other'
    };

    const nodeStyle = `
      position:absolute;
      left:${pos.x + padding}px;
      top:${pos.y + padding}px;
      width:160px;
      border-radius:8px;
      padding:8px 10px;
      text-align:center;
      z-index:1;
    `;

    // Build time display
    const timeDisplay = totalTime
      ? `<div class="node-time" style="font-size:10px;margin-top:2px;font-weight:500;">⏱ ${totalTime}</div>`
      : '';

    // Build table name display for scan operators
    let tableDisplay = '';
    if (isScanOperator(node.name) && node.metrics) {
      const scanMetrics = getScanMetrics(node.metrics);
      if (scanMetrics && scanMetrics.table && scanMetrics.table !== 'N/A') {
        const tableName = scanMetrics.table.length > 20
          ? scanMetrics.table.substring(0, 18) + '...'
          : scanMetrics.table;
        tableDisplay = `<div class="node-table" style="font-size:9px;margin-top:2px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${scanMetrics.table}">📋 ${tableName}</div>`;
      }
    }

    nodesHtml += `
      <div id="node-${id}" class="plan-node ${nodeClass} ${hasMetrics ? 'has-metrics' : ''}"
           style="${nodeStyle}"
           ${hasMetrics ? `onclick="toggleNodeMetrics('${id}', event)"` : ''}>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <span class="node-name" style="font-size:11px;font-weight:600;">${displayName}</span>
          ${hasMetrics ? `<span id="icon-${id}" class="expand-icon" style="font-size:8px;">▼</span>` : ''}
        </div>
        <div class="node-id" style="font-size:10px;margin-top:2px;">id=${node.planNodeId}</div>
        ${timeDisplay}
        ${tableDisplay}
        ${metricsDropdown}
      </div>
    `;
  }

  // Store content size for viewport calculations
  currentContentSize = { width: width + padding * 2, height: height + padding * 2 };

  // Wrap content in zoom-container for CSS transform-based pan/zoom
  planCanvas.innerHTML = `
    <div class="zoom-container">
      <div style="position:relative;width:${width + padding * 2}px;height:${height + padding * 2}px;">
        <svg class="plan-svg" style="position:absolute;top:0;left:0;" width="${width + padding * 2}" height="${height + padding * 2}">
          <g transform="translate(${padding}, ${padding})">${edgeSvg}</g>
        </svg>
        <div style="position:absolute;top:0;left:0;width:${width + padding * 2}px;height:${height + padding * 2}px;">
          ${nodesHtml}
        </div>
      </div>
    </div>
  `;
}
