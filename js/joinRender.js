/**
 * Join Summary rendering functions
 */

import { calculateJoinStats } from './joinParser.js';
import { setupNodeLinkHandlers } from './nodePopup.js';

// Define the column configuration for the join table
// Columns are grouped into subsections
export const JOIN_METRICS_CONFIG = [
  // === Summary Section ===
  { key: 'planNodeId',           label: 'Plan Node ID',      source: 'summary', type: 'number',    group: 'Summary', clickable: true },
  { key: 'joinType',             label: 'Join Type',         source: 'summary', type: 'string',    group: 'Summary' },
  { key: 'distributionMode',     label: 'Distribution',      source: 'summary', type: 'string',    group: 'Summary' },
  { key: 'totalTime',            label: 'Total Time',        source: 'summary', type: 'time',      group: 'Summary' },
  { key: 'joinPredicates',       label: 'Predicates',        source: 'summary', type: 'predicate', group: 'Summary' },

  // === Probe Side (HASH_JOIN_PROBE) ===
  { key: 'pullRowNum',           label: 'Pull Rows',         source: 'probe',   type: 'rows',      group: 'Probe Side' },
  { key: 'pushRowNum',           label: 'Push Rows',         source: 'probe',   type: 'rows',      group: 'Probe Side' },
  { key: 'outputChunkBytes',     label: 'Output Bytes',      source: 'probe',   type: 'bytes',     group: 'Probe Side' },
  { key: 'operatorTotalTime',    label: 'Operator Time',     source: 'probe',   type: 'timeWithPct', group: 'Probe Side' },
  { key: 'searchHashTableTime',  label: 'Search HT Time',    source: 'probe',   type: 'time',      group: 'Probe Side' },
  { key: 'probeConjunctEvaluateTime', label: 'Probe Conjunct', source: 'probe', type: 'time',      group: 'Probe Side' },

  // === Build Side (HASH_JOIN_BUILD) ===
  { key: 'pushRowNum',           label: 'Push Rows',         source: 'build',   type: 'rows',      group: 'Build Side' },
  { key: 'buildInputRows',       label: 'Input Rows',        source: 'build',   type: 'rows',      group: 'Build Side' },
  { key: 'hashTableMemoryUsage', label: 'HT Memory',         source: 'build',   type: 'bytes',     group: 'Build Side' },
  { key: 'peakRevocableMemoryBytes', label: 'Peak Revocable', source: 'build', type: 'bytes',     group: 'Build Side' },
  { key: 'operatorTotalTime',    label: 'Operator Time',     source: 'build',   type: 'timeWithPct', group: 'Build Side' },
  { key: 'buildHashTableTime',   label: 'Build HT Time',     source: 'build',   type: 'time',      group: 'Build Side' },
  { key: 'copyRightTableChunkTime', label: 'Copy Right Time', source: 'build', type: 'time',      group: 'Build Side' },
  { key: 'rowsSpilled',          label: 'Rows Spilled',      source: 'build',   type: 'rows',      group: 'Build Side' },
];

// Store data globally for sorting
let currentJoinData = [];
let joinSortColumn = null;
let joinSortDirection = 'asc';
let joinGroupStartIndices = new Set();

/**
 * Main function to render the join dashboard
 */
export function renderJoinDashboard(summary, execution, joins, dropZone, dashboard) {
  // Hide drop zone, show dashboard
  dropZone.classList.add('hidden');
  dashboard.classList.add('visible');

  // Store for sorting
  currentJoinData = joins;

  // 1. Render Query Metadata
  renderJoinQueryMeta(summary);

  // 2. Render Summary Cards
  renderJoinSummaryCards(joins, execution);

  // 3. Render the Join Table
  renderJoinTable(joins);
}

/**
 * Render Query Metadata Section for Join tab
 */
function renderJoinQueryMeta(summary) {
  const container = document.getElementById('joinQueryMeta');

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
 * Render Join Summary Cards
 */
function renderJoinSummaryCards(joins, execution) {
  const stats = calculateJoinStats(joins);

  // Helper to render cards
  const renderCards = (cards) => cards.map(c => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.type}">${c.value}</div>
    </div>
  `).join('');

  // Helper to render cards with percentage subtitle
  const renderCardsWithPct = (cards) => cards.map(c => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.type}">${c.value}</div>
      ${c.pct !== undefined ? `<div class="card-pct">${c.pct.toFixed(1)}% of total</div>` : ''}
    </div>
  `).join('');

  // Memory Section
  const memoryCards = [
    { label: 'Total Hash Table Memory', value: stats.totalHashTableMemory, type: 'bytes' },
    { label: 'Max Hash Table Memory', value: stats.maxHashTableMemory, type: 'bytes' },
    { label: 'Rows Spilled', value: stats.totalRowsSpilled.toLocaleString(), type: 'rows' },
  ];
  document.querySelector('#joinMemoryCards .summary-cards').innerHTML = renderCards(memoryCards);

  // Time Section - with percentages for build/probe
  const timeCards = [
    { label: 'Total Join Operators', value: stats.totalJoins, type: 'number' },
    { label: 'Total Time', value: stats.totalTime, type: 'time' },
    { label: 'Total Build Time', value: stats.totalBuildTime, type: 'time', pct: stats.totalBuildTimePct },
    { label: 'Total Probe Time', value: stats.totalProbeTime, type: 'time', pct: stats.totalProbeTimePct },
  ];
  document.querySelector('#joinTimeCards .summary-cards').innerHTML = renderCardsWithPct(timeCards);
}

/**
 * Render Join Data Table with Grouped Headers
 */
function renderJoinTable(joins) {
  const thead = document.getElementById('joinTableHead');
  const tbody = document.getElementById('joinTableBody');

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
  joinGroupStartIndices = new Set();

  JOIN_METRICS_CONFIG.forEach((col, idx) => {
    if (col.group !== currentGroup) {
      // Save the previous group if it existed
      if (colspan > 0) {
        groupCells.push({ group: currentGroup, colspan });
      }
      // Track the start of a new group
      if (col.group !== null) {
        joinGroupStartIndices.add(idx);
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
  groupCells.forEach(cell => {
    const th = document.createElement('th');
    th.colSpan = cell.colspan;
    if (cell.group === null) {
      th.className = 'group-spacer';
      th.textContent = '';
    } else {
      th.textContent = cell.group;
      // Add special styling for different sections
      if (cell.group === 'Probe Side') {
        th.classList.add('probe-header');
      } else if (cell.group === 'Build Side') {
        th.classList.add('build-header');
      }
    }
    groupHeaderRow.appendChild(th);
  });

  // =============================================
  // ROW 2: Individual Column Headers (sortable)
  // =============================================
  const columnHeaderRow = document.createElement('tr');

  JOIN_METRICS_CONFIG.forEach((col, idx) => {
    const th = document.createElement('th');
    th.dataset.col = idx;
    th.dataset.key = col.key;
    th.dataset.source = col.source;
    th.textContent = col.label;

    // Add group-start class for left border
    if (joinGroupStartIndices.has(idx)) {
      th.classList.add('group-start');
    }

    // Add click handler for sorting
    th.addEventListener('click', () => sortJoinTable(th));

    columnHeaderRow.appendChild(th);
  });

  // Append both rows to thead
  thead.appendChild(groupHeaderRow);
  thead.appendChild(columnHeaderRow);

  // Build body rows
  renderJoinTableBody(joins);
}

/**
 * Render join table body rows
 */
function renderJoinTableBody(joins) {
  const tbody = document.getElementById('joinTableBody');

  tbody.innerHTML = joins.map(join => {
    const cells = JOIN_METRICS_CONFIG.map((col, idx) => {
      // Get value based on source
      let value;
      if (col.source === 'summary') {
        value = join[col.key];
      } else if (col.source === 'probe') {
        value = join.probe ? join.probe[col.key] : '-';
      } else if (col.source === 'build') {
        value = join.build ? join.build[col.key] : '-';
      }

      // Apply styling based on type
      let displayValue = value ?? '-';
      let classNames = [];

      // Add group-start class for left border
      if (joinGroupStartIndices.has(idx)) {
        classNames.push('group-start');
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
          if (typeof displayValue === 'string' && displayValue.length > 50) {
            displayValue = displayValue.substring(0, 50) + '...';
          }
          break;
        case 'bytes':
          classNames.push('number', 'bytes');
          break;
        case 'time':
          classNames.push('number', 'time');
          break;
        case 'timeWithPct':
          classNames.push('number', 'time');
          // Get the percentage from the source (probe or build)
          const sourceObj = col.source === 'probe' ? join.probe : join.build;
          if (sourceObj && sourceObj.operatorTimePct !== undefined) {
            const pct = sourceObj.operatorTimePct.toFixed(1);
            displayValue = `${value} (${pct}%)`;
          }
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
        displayValue = `<span class="node-link" data-node-id="${value}" data-node-type="join">${displayValue}</span>`;
      }

      return `<td class="${classNames.join(' ')}" title="${value || ''}">${displayValue}</td>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  // Add click handlers for node links
  setupNodeLinkHandlers(tbody, 'join');
}

/**
 * Parse numeric value from strings like "18.636 KB" or "1.592ms"
 */
function parseNumericValue(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return 0;
  }

  // Handle string values
  if (typeof value === 'string') {
    // Match numbers (including decimals) possibly followed by units
    const match = value.match(/([\d.]+)/);
    if (match) {
      return parseFloat(match[1]);
    }
    return 0;
  }

  return Number(value) || 0;
}

/**
 * Sort join table by column
 */
function sortJoinTable(th) {
  const key = th.dataset.key;
  const source = th.dataset.source;
  const colIndex = parseInt(th.dataset.col);
  const config = JOIN_METRICS_CONFIG[colIndex];

  // Toggle direction if same column
  if (joinSortColumn === key + source) {
    joinSortDirection = joinSortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    joinSortColumn = key + source;
    joinSortDirection = 'asc';
  }

  // Update header styling
  document.querySelectorAll('#joinTableHead th').forEach(t => {
    t.classList.remove('sorted-asc', 'sorted-desc');
  });
  th.classList.add(joinSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

  // Sort the data
  currentJoinData.sort((a, b) => {
    let valA, valB;

    if (source === 'summary') {
      valA = a[key] ?? '';
      valB = b[key] ?? '';
    } else if (source === 'probe') {
      valA = a.probe ? a.probe[key] : '';
      valB = b.probe ? b.probe[key] : '';
    } else if (source === 'build') {
      valA = a.build ? a.build[key] : '';
      valB = b.build ? b.build[key] : '';
    }

    // Parse numeric values
    if (config.type !== 'string' && config.type !== 'predicate') {
      // For timeWithPct, sort by the percentage for more meaningful ordering
      if (config.type === 'timeWithPct') {
        const sourceObjA = config.source === 'probe' ? a.probe : a.build;
        const sourceObjB = config.source === 'probe' ? b.probe : b.build;
        valA = sourceObjA ? sourceObjA.operatorTimePct : 0;
        valB = sourceObjB ? sourceObjB.operatorTimePct : 0;
      } else {
        valA = parseNumericValue(valA);
        valB = parseNumericValue(valB);
      }
    }

    // Compare
    if (valA < valB) return joinSortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return joinSortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Re-render table body
  renderJoinTableBody(currentJoinData);
}
