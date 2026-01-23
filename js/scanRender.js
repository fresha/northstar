/**
 * Dashboard rendering functions
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes } from './utils.js';
import { setupNodeLinkHandlers } from './nodePopup.js';

// Define which metrics we want to display (from user requirements)
// Columns are grouped - columns with the same 'group' value will share a header
// group: null means no group header (standalone column)
export const METRICS_CONFIG = [
  // === General Info (no group) ===
  { key: 'Table',                           label: 'Table',              source: 'unique', type: 'string',    group: null,       sticky: true },
  { key: 'planNodeId',                      label: 'Node ID',            source: 'meta',   type: 'number',    group: null,       clickable: true },
  { key: 'Predicates',                      label: 'Predicates',         source: 'unique', type: 'predicate', group: null },
  
  // === Timing Metrics (no group) ===
  { key: 'PullRowNum',                      label: 'Pull Rows',          source: 'common', type: 'rows',      group: null },
  { key: 'JoinRuntimeFilterInputRows',      label: 'RF Input',           source: 'common', type: 'rows',      group: null },
  { key: 'JoinRuntimeFilterOutputRows',     label: 'RF Output',          source: 'common', type: 'rows',      group: null },
  { key: 'BytesRead',                       label: 'Bytes Read',         source: 'unique', type: 'bytes',     group: null },
  { key: 'OperatorTotalTime',               label: 'Operator Time',      source: 'common', type: 'time',      group: 'Run Time' },
  { key: 'ScanTime',                        label: 'Scan Time',          source: 'unique', type: 'time',      group: 'Run Time' },
  { key: 'IOTaskExecTime',                  label: 'IO Exec',            source: 'unique', type: 'time',      group: 'Scan Time' },
  { key: 'IOTaskWaitTime',                  label: 'IO Wait',            source: 'unique', type: 'time',      group: 'Scan Time' },
  { key: 'SegmentInit',                     label: 'Seg Init',           source: 'unique', type: 'time',      group: 'Scan Time' },
  { key: 'SegmentRead',                     label: 'Seg Read',           source: 'unique', type: 'time',      group: 'Scan Time' },
  
  // === Row Metrics (no group) ===
  { key: 'RowsRead',                        label: 'Rows Read',          source: 'unique', type: 'rows',      group: 'Pred Filters' },
  { key: 'PredFilterRows',                  label: 'Pred Filter',        source: 'unique', type: 'rows',      group: 'Pred Filters' },
  { key: 'LateMaterializeRows',             label: 'Late Mat',           source: 'unique', type: 'rows',      group: 'Pred Filters' },
  { key: 'RawRowsRead',                     label: 'Raw Rows Read',      source: 'unique', type: 'rows',      group: 'Pred Filters' },
        
  // === Index Filters (GROUPED) ===
  { key: 'DelVecFilterRows',                label: 'Del Vec',            source: 'unique', type: 'rows',      group: 'Index Filters' },
  { key: 'ZoneMapIndexFilterRows',          label: 'Zone Map',           source: 'unique', type: 'rows',      group: 'Index Filters' },
  { key: 'SegmentZoneMapFilterRows',        label: 'Seg Zone Map',       source: 'unique', type: 'rows',      group: 'Index Filters' },
  { key: 'BloomFilterFilterRows',           label: 'Bloom',              source: 'unique', type: 'rows',      group: 'Index Filters' },

  // === Short Key Filtering (GROUPED) ===
  { key: 'RemainingRowsAfterShortKeyFilter',label: 'Rows After ShortKey',source: 'unique', type: 'rows',      group: 'Short Key' },
  { key: 'ShortKeyFilterRows',              label: 'ShortKey Filter',    source: 'unique', type: 'rows',      group: 'Short Key' },

  // === Scan Structure (GROUPED) ===
  { key: 'TabletCount',                     label: 'Tablets',            source: 'unique', type: 'number',    group: 'Scan Structure' },
  { key: 'RowsetsReadCount',                label: 'Rowsets',            source: 'unique', type: 'number',    group: 'Scan Structure' },
  { key: 'SegmentsReadCount',               label: 'Segments',           source: 'unique', type: 'number',    group: 'Scan Structure' },
  { key: 'PagesCountTotal',                 label: 'Pages',              source: 'unique', type: 'number',    group: 'Scan Structure' },
];

// Store data globally for sorting
let currentData = [];
let sortColumn = null;
let sortDirection = 'asc';
let groupStartIndices = new Set();

/**
 * Main function to render the dashboard
 */
export function renderDashboard(summary, execution, connectorScans, dropZone, dashboard) {
  // Hide drop zone, show dashboard
  dropZone.classList.add('hidden');
  dashboard.classList.add('visible');

  // Store for sorting
  currentData = connectorScans;

  // 1. Render Query Metadata
  renderQueryMeta(summary);

  // 2. Render Summary Cards
  renderSummaryCards(connectorScans, execution);

  // 3. Render the Table
  renderTable(connectorScans);
}

/**
 * Render Query Metadata Section
 */
function renderQueryMeta(summary) {
  const container = document.getElementById('queryMeta');
  
  // Define which fields to show
  const fields = [
    { label: 'Query ID', key: 'Query ID' },
    { label: 'Start Time', key: 'Start Time' },
    { label: 'Duration', key: 'Total' },
    { label: 'State', key: 'Query State' },
    { label: 'User', key: 'User' },
    { label: 'Database', key: 'Default Db' },
    { label: 'Warehouse', key: 'Warehouse' },
  ];

  container.innerHTML = fields.map(f => `
    <div class="meta-item">
      <label>${f.label}</label>
      <span>${summary[f.key] || 'N/A'}</span>
    </div>
  `).join('');
}

/**
 * Render Summary Cards (Organized in Sections)
 */
function renderSummaryCards(scans, execution) {
  // Calculate totals from CONNECTOR_SCAN operators
  const totalScans = scans.length;
  const totalBytesRead = sumMetric(scans, 'BytesRead', 'unique');
  const totalRowsRead = sumMetric(scans, 'RowsRead', 'unique');
  const totalRawRows = sumMetric(scans, 'RawRowsRead', 'unique');

  // Get execution-level metrics directly from the Execution object
  const allocatedMemory = execution.QueryAllocatedMemoryUsage || 'N/A';
  const sumMemory = execution.QuerySumMemoryUsage || 'N/A';
  const cpuTime = execution.QueryCumulativeCpuTime || 'N/A';
  const scanTime = execution.QueryCumulativeScanTime || 'N/A';
  const operatorTime = execution.QueryCumulativeOperatorTime || 'N/A';
  const networkTime = execution.QueryCumulativeNetworkTime || 'N/A';

  // Helper to render cards
  const renderCards = (cards) => cards.map(c => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.type}">${c.value}</div>
    </div>
  `).join('');

  // Memory Section
  const memoryCards = [
    { label: 'Allocated Memory', value: allocatedMemory, type: 'bytes' },
    { label: 'Sum Memory Usage', value: sumMemory, type: 'bytes' },
  ];
  document.querySelector('#memoryCards .summary-cards').innerHTML = renderCards(memoryCards);

  // Time Section
  const timeCards = [
    { label: 'CPU Time', value: cpuTime, type: 'time' },
    { label: 'Scan Time', value: scanTime, type: 'time' },
    { label: 'Operator Time', value: operatorTime, type: 'time' },
    { label: 'Network Time', value: networkTime, type: 'time' },
  ];
  document.querySelector('#timeCards .summary-cards').innerHTML = renderCards(timeCards);

  // Scan Metrics Section
  const scanMetricCards = [
    { label: 'Connector Scan Operators', value: totalScans, type: 'number' },
    { label: 'Total Bytes Read', value: formatBytes(totalBytesRead), type: 'bytes' },
    { label: 'Total Rows Scanned', value: formatNumber(totalRawRows), type: 'rows' },
    { label: 'Total Rows Read', value: formatNumber(totalRowsRead), type: 'rows' },
  ];
  document.querySelector('#scanCards .summary-cards').innerHTML = renderCards(scanMetricCards);
}

/**
 * Render Data Table with Grouped Headers
 */
function renderTable(scans) {
  const thead = document.getElementById('tableHead');

  // Clear existing content
  thead.innerHTML = '';

  // =============================================
  // ROW 1: Group Headers (spans multiple columns)
  // =============================================
  const groupHeaderRow = document.createElement('tr');
  groupHeaderRow.className = 'group-header-row';
  
  let currentGroup = null;
  let colspan = 0;
  let groupCells = [];

  // Track which columns start a new group (for border styling)
  groupStartIndices = new Set();

  METRICS_CONFIG.forEach((col, idx) => {
    if (col.group !== currentGroup) {
      // Save the previous group if it existed
      if (colspan > 0) {
        groupCells.push({ group: currentGroup, colspan });
      }
      // Track the start of a new group
      if (col.group !== null) {
        groupStartIndices.add(idx);
      }
      currentGroup = col.group;
      colspan = 1;
    } else {
      colspan++;
    }
  });
  // Don't forget the last group
  if (colspan > 0) {
    groupCells.push({ group: currentGroup, colspan });
  }

  // Build the group header row
  // Count leading sticky columns
  let stickyCount = 0;
  while (stickyCount < METRICS_CONFIG.length && METRICS_CONFIG[stickyCount].sticky) {
    stickyCount++;
  }

  let colOffset = 0;
  groupCells.forEach(cell => {
    const cellStart = colOffset;
    const cellEnd = colOffset + cell.colspan;
    colOffset = cellEnd;

    // Check if this cell contains sticky columns
    if (cellStart < stickyCount) {
      // Add separate cell(s) for sticky columns
      const stickyInCell = Math.min(stickyCount, cellEnd) - cellStart;
      for (let i = 0; i < stickyInCell; i++) {
        const th = document.createElement('th');
        th.className = 'group-spacer sticky-col';
        th.textContent = '';
        groupHeaderRow.appendChild(th);
      }
      // If there are non-sticky columns remaining in this cell
      const remaining = cell.colspan - stickyInCell;
      if (remaining > 0) {
        const th = document.createElement('th');
        th.colSpan = remaining;
        th.className = cell.group === null ? 'group-spacer' : '';
        th.textContent = cell.group || '';
        groupHeaderRow.appendChild(th);
      }
    } else {
      // No sticky columns in this cell, render normally
      const th = document.createElement('th');
      th.colSpan = cell.colspan;
      if (cell.group === null) {
        th.className = 'group-spacer';
        th.textContent = '';
      } else {
        th.textContent = cell.group;
      }
      groupHeaderRow.appendChild(th);
    }
  });

  // =============================================
  // ROW 2: Individual Column Headers (sortable)
  // =============================================
  const columnHeaderRow = document.createElement('tr');
  
  METRICS_CONFIG.forEach((col, idx) => {
    const th = document.createElement('th');
    th.dataset.col = idx;
    th.dataset.key = col.key;
    th.textContent = col.label;

    // Add group-start class for left border
    if (groupStartIndices.has(idx)) {
      th.classList.add('group-start');
    }

    // Add sticky class for fixed columns
    if (col.sticky) {
      th.classList.add('sticky-col');
    }

    // Add click handler for sorting
    th.addEventListener('click', () => sortTable(th));

    columnHeaderRow.appendChild(th);
  });

  // Append both rows to thead
  thead.appendChild(groupHeaderRow);
  thead.appendChild(columnHeaderRow);

  // Build body rows
  renderTableBody(scans);
}

/**
 * Render table body rows
 */
function renderTableBody(scans) {
  const tbody = document.getElementById('tableBody');

  tbody.innerHTML = scans.map(scan => {
    const cells = METRICS_CONFIG.map((col, idx) => {
      // Get value from commonMetrics, uniqueMetrics, or directly from scan object (meta)
      const source = col.source === 'meta' ? scan : (col.source === 'common' ? scan.commonMetrics : scan.uniqueMetrics);
      const value = source[col.key];

      // Apply styling based on type
      let displayValue = value ?? '-';
      let classNames = [];

      // Add group-start class for left border
      if (groupStartIndices.has(idx)) {
        classNames.push('group-start');
      }

      // Add sticky class for fixed columns
      if (col.sticky) {
        classNames.push('sticky-col');
      }

      // Add clickable class for interactive columns
      if (col.clickable) {
        classNames.push('clickable-cell');
      }

      switch (col.type) {
        case 'string':
          classNames.push('table-name');
          break;
        case 'predicate':
          classNames.push('predicate');
          // Truncate long predicates
          if (displayValue.length > 50) {
            displayValue = displayValue.substring(0, 50) + '...';
          }
          break;
        case 'bytes':
          classNames.push('number', 'bytes');
          break;
        case 'time':
          classNames.push('number', 'time');
          break;
        case 'rows':
          classNames.push('number', 'rows');
          break;
        case 'number':
          classNames.push('number');
          break;
      }

      // If clickable, wrap content in a link-like span with data attribute
      if (col.clickable && displayValue !== '-') {
        displayValue = `<span class="node-link" data-node-id="${value}">${displayValue}</span>`;
      }

      return `<td class="${classNames.join(' ')}" title="${value || ''}">${displayValue}</td>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  // Add click handlers for node links
  setupNodeLinkHandlers(tbody, 'scan');
}

/**
 * Sort table by column
 */
function sortTable(th) {
  const key = th.dataset.key;
  const colIndex = parseInt(th.dataset.col);
  const config = METRICS_CONFIG[colIndex];
  
  // Toggle direction if same column
  if (sortColumn === key) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = key;
    sortDirection = 'asc';
  }

  // Update header styling
  document.querySelectorAll('#tableHead th').forEach(t => {
    t.classList.remove('sorted-asc', 'sorted-desc');
  });
  th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

  // Sort the data
  currentData.sort((a, b) => {
    const sourceA = config.source === 'meta' ? a : (config.source === 'common' ? a.commonMetrics : a.uniqueMetrics);
    const sourceB = config.source === 'meta' ? b : (config.source === 'common' ? b.commonMetrics : b.uniqueMetrics);
    
    let valA = sourceA[key] ?? '';
    let valB = sourceB[key] ?? '';

    // Parse numeric values from strings like "18.636 KB" or "1.592ms"
    if (config.type !== 'string' && config.type !== 'predicate') {
      valA = parseNumericValue(valA);
      valB = parseNumericValue(valB);
    }

    // Compare
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Re-render table body
  renderTableBody(currentData);
}

