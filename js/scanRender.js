/**
 * Dashboard rendering functions
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes } from './utils.js';
import { setupNodeLinkHandlers } from './nodePopup.js';
import { classifyScanOperators } from './scanParser.js';

// Define which metrics we want to display for internal scans (OLAP_SCAN + LakeDataSource)
// Columns are grouped - columns with the same 'group' value will share a header
// group: null means no group header (standalone column)
// description: tooltip text explaining the metric
// headerClass: CSS class for colored group headers
export const METRICS_CONFIG = [
  // === Summary (identity info) ===
  { key: 'Table',                           label: 'Table',              source: 'unique', type: 'string',    group: 'Summary',       sticky: true, description: 'Name of the table being scanned' },
  { key: 'planNodeId',                      label: 'Node ID',            source: 'meta',   type: 'number',    group: 'Summary',       clickable: true, description: 'Plan node identifier in the query execution tree' },
  { key: 'Predicates',                      label: 'Predicates',         source: 'unique', type: 'predicate', group: 'Summary', description: 'Filter conditions applied during the scan' },

  // === Output (what the scan produces) ===
  { key: 'PullRowNum',                      label: 'Pull Rows',          source: 'common', type: 'rows',      group: 'Output', headerClass: 'output-header', description: 'Final output rows from the scan operator' },
  { key: 'BytesRead',                       label: 'Bytes Read',         source: 'unique', type: 'bytes',     group: 'Output', headerClass: 'output-header', description: 'Total bytes read from storage' },

  // === Operator Time (top-level timing + skew) ===
  { key: 'OperatorTotalTime',               label: 'Operator Time',      source: 'common', type: 'time', group: 'Operator Time', headerClass: 'operator-time-header', description: 'Total time spent in this operator' },
  { key: 'OperatorSkew',                    label: 'Skew',               source: 'computed', type: 'skew',    group: 'Operator Time', headerClass: 'operator-time-header', description: 'Max/min ratio across tablets - high values indicate data skew' },

  // === Scan Time (hierarchical breakdown) ===
  { key: 'ScanTime',                        label: 'Scan Time',          source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time spent performing the actual scan operation (sum across all instances)' },
  { key: 'MaxScanTime',                     label: 'Max',               source: 'computed', type: 'time',     group: 'Scan Time', headerClass: 'scan-time-header', description: 'Maximum scan time across any single instance - represents the real bottleneck' },
  { key: 'ScanSkew',                        label: 'Skew',              source: 'computed', type: 'skew',     group: 'Scan Time', headerClass: 'scan-time-header', description: 'Scan time max/min ratio - high values indicate uneven data distribution' },
  { key: 'IOTaskWaitTime',                  label: 'IO Wait',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time waiting for I/O - high % indicates thread-pool starvation' },
  { key: 'IOTaskExecTime',                  label: 'IO Exec',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time executing I/O operations (reading from disk/cache)' },
  { key: 'SegmentInit',                     label: 'Seg Init',           source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time initializing segments - high values indicate fragmentation' },
  { key: 'SegmentRead',                     label: 'Seg Read',           source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time spent reading data from segments' },

  // === Index Filters (storage-tier filtering) ===
  { key: 'ZoneMapIndexFilterRows',          label: 'Zone Map',           source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using zone map index (min/max per column chunk)' },
  { key: 'SegmentZoneMapFilterRows',        label: 'Seg Zone Map',       source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered at segment level using zone maps' },
  { key: 'BloomFilterFilterRows',           label: 'Bloom',              source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using bloom filter index' },
  { key: 'ShortKeyFilterRows',              label: 'ShortKey',           source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using short key index (first N sort key columns)' },
  { key: 'DelVecFilterRows',               label: 'Del Vec',            source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered by delete vector - high values indicate need for compaction' },

  // === Predicate Filters (predicate pushdown effectiveness) ===
  { key: 'RawRowsRead',                     label: 'Raw Rows',           source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Total raw rows read after index filtering' },
  { key: 'PredFilterRows',                  label: 'Pred Filter',        source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Rows filtered out by predicate evaluation' },
  { key: 'RowsRead',                        label: 'Rows Read',          source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Rows remaining after predicate filters' },
  { key: 'PushdownPredicates',              label: 'Pushdown Count',     source: 'unique', type: 'number',    group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Number of predicates pushed to storage - 0 indicates pushdown issues' },

  // === Runtime Filters (join-pushed filters) ===
  { key: 'JoinRuntimeFilterInputRows',      label: 'RF Input',           source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows before applying runtime filters from joins' },
  { key: 'JoinRuntimeFilterOutputRows',     label: 'RF Output',          source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows after runtime filters - lower = more effective filtering' },

  // === Storage (fragmentation indicators) ===
  { key: 'TabletCount',                     label: 'Tablets',            source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of tablets scanned (data partitions)' },
  { key: 'RowsetsReadCount',                label: 'Rowsets',            source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of rowsets - high count indicates fragmentation' },
  { key: 'SegmentsReadCount',               label: 'Segments',           source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of segments read (columnar storage files)' },
];

// Define metrics for external scans (Iceberg/Hive via HiveDataSource)
export const EXTERNAL_METRICS_CONFIG = [
  // === Summary (identity info) ===
  { key: 'Table',                           label: 'Table',              source: 'unique', type: 'string',    group: 'Summary',       sticky: true, description: 'Name of the table being scanned' },
  { key: 'planNodeId',                      label: 'Node ID',            source: 'meta',   type: 'number',    group: 'Summary',       clickable: true, description: 'Plan node identifier in the query execution tree' },
  { key: 'Predicates',                      label: 'Predicates',         source: 'unique', type: 'predicate', group: 'Summary', description: 'Filter conditions applied during the scan' },

  // === Health (compaction assessment) ===
  { key: 'CompactionHealth',                label: 'Compaction',          source: 'computed', type: 'health',   group: 'Health', headerClass: 'health-header', description: 'Compaction health based on delete files, file sizes, and open overhead' },

  // === Output (what the scan produces) ===
  { key: 'PullRowNum',                      label: 'Pull Rows',          source: 'common', type: 'rows',      group: 'Output', headerClass: 'output-header', description: 'Final output rows from the scan operator' },
  { key: 'TotalBytesRead',                  label: 'Total Read',         source: 'computed', type: 'bytes',   group: 'Output', headerClass: 'output-header', description: 'Total bytes read (cache hits + remote fetches)' },

  // === Operator Time (top-level timing + skew) ===
  { key: 'OperatorTotalTime',               label: 'Operator Time',      source: 'common', type: 'time', group: 'Operator Time', headerClass: 'operator-time-header', description: 'Total time spent in this operator' },
  { key: 'OperatorSkew',                    label: 'Skew',               source: 'computed', type: 'skew',    group: 'Operator Time', headerClass: 'operator-time-header', description: 'Max/avg ratio - high values indicate data skew' },

  // === Scan Time (hierarchical breakdown) ===
  { key: 'ScanTime',                        label: 'Scan Time',          source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Average time spent scanning across instances' },
  { key: 'MaxScanTime',                     label: 'Max',               source: 'computed', type: 'time',     group: 'Scan Time', headerClass: 'scan-time-header', description: 'Maximum scan time across any single instance - the real bottleneck' },
  { key: 'ScanSkew',                        label: 'Skew',              source: 'computed', type: 'skew',     group: 'Scan Time', headerClass: 'scan-time-header', description: 'Scan time max/avg ratio - high values indicate uneven data distribution' },
  { key: 'IOTaskWaitTime',                  label: 'IO Wait',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time waiting for I/O thread - high % indicates thread-pool starvation' },
  { key: 'IOTaskExecTime',                  label: 'IO Exec',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time executing I/O operations (reading from object storage/cache)' },
  { key: 'OpenFile',                        label: 'Open File',          source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time opening Parquet files from object storage - high values indicate network latency or too many small files' },

  // === Data IO (cache effectiveness + remote IO) ===
  { key: 'DataCacheReadBytes',              label: 'Cache Hit',          source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Bytes served from local data cache (SSD + memory) - avoids remote storage' },
  { key: 'DataCacheReadDiskBytes',          label: 'Cache SSD',          source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Bytes served from local SSD cache' },
  { key: 'DataCacheReadMemBytes',           label: 'Cache Mem',          source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Bytes served from in-memory cache' },
  { key: 'FSIOBytesRead',                   label: 'Remote IO',         source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Bytes read from remote filesystem/object storage (cold reads that bypassed cache) - non-zero means data was not cached' },
  { key: 'DataCacheWriteBytes',             label: 'Cache Write',        source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Bytes written to local data cache after a cache miss - indicates cache warming activity' },
  { key: 'CacheHitRate',                    label: 'Hit Rate',           source: 'computed', type: 'pct',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Cache Hit / (Cache Hit + Remote IO) - percentage of data served from local cache vs remote object storage' },
  { key: 'AppIOBytesRead',                  label: 'App IO',             source: 'unique', type: 'bytes',     group: 'Data IO', headerClass: 'data-cache-header', description: 'Application-level bytes requested - routed through cache or remote storage' },

  // === Scan Ranges (file splits) ===
  { key: 'ScanRanges',                      label: 'Ranges',             source: 'unique', type: 'number',    group: 'Scan Ranges', headerClass: 'storage-header', description: 'Number of file splits distributed across compute nodes - more ranges = more parallelism' },
  { key: 'ScanRangesSize',                  label: 'Total Size',         source: 'unique', type: 'bytes',     group: 'Scan Ranges', headerClass: 'storage-header', description: 'Total raw size of all file splits on disk before any filtering' },
  { key: 'AvgFileSize',                     label: 'Avg File',           source: 'computed', type: 'bytes',   group: 'Scan Ranges', headerClass: 'storage-header', description: 'Average file size (Total Size / Ranges) - ideally > 64 MB, small files cause overhead' },

  // === Compression (Parquet encoding efficiency) ===
  { key: 'RequestBytesRead',                label: 'Compressed',         source: 'unique', type: 'bytes',     group: 'Compression', headerClass: 'storage-header', description: 'Compressed bytes read from Parquet files' },
  { key: 'RequestBytesReadUncompressed',    label: 'Uncompressed',       source: 'unique', type: 'bytes',     group: 'Compression', headerClass: 'storage-header', description: 'Uncompressed bytes after decoding - the actual data size in memory' },
  { key: 'CompressionRatio',               label: 'Ratio',              source: 'computed', type: 'ratio',   group: 'Compression', headerClass: 'storage-header', description: 'Compression ratio (uncompressed / compressed) - higher means better compression' },

  // === Parquet Filters (file-level filtering effectiveness) ===
  { key: 'TotalRowGroups',                  label: 'Row Groups',         source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Total Parquet row groups scanned' },
  { key: 'FilteredRowGroups',               label: 'Filtered RG',       source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Row groups skipped entirely using statistics - higher is better' },
  { key: 'RowGroupFilterRate',              label: 'RG Filter %',        source: 'computed', type: 'pct',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Percentage of row groups filtered out (Filtered / Total) - higher means more data skipped' },
  { key: 'BloomFilterSuccessCounter',       label: 'Bloom Hit',          source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Parquet bloom filter successful prunes' },
  { key: 'BloomFilterTriedCounter',         label: 'Bloom Tried',        source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Parquet bloom filter attempted checks' },
  { key: 'PageIndexSuccessCounter',         label: 'PageIdx Hit',        source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Parquet page index successful prunes' },
  { key: 'PageIndexTriedCounter',           label: 'PageIdx Tried',      source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Parquet page index attempted checks' },
  { key: 'StatisticsSuccessCounter',        label: 'Stats Hit',          source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Min/max statistics successful prunes (similar to zone map)' },
  { key: 'StatisticsTriedCounter',          label: 'Stats Tried',        source: 'unique', type: 'number',    group: 'Parquet Filters', headerClass: 'parquet-filters-header', description: 'Min/max statistics attempted checks' },

  // === Row Processing (row-level filtering) ===
  { key: 'RawRowsRead',                     label: 'Raw Rows',           source: 'unique', type: 'rows',      group: 'Row Processing', headerClass: 'row-processing-header', description: 'Total raw rows read from Parquet files after file-level filtering' },
  { key: 'RowsRead',                        label: 'Rows Read',          source: 'unique', type: 'rows',      group: 'Row Processing', headerClass: 'row-processing-header', description: 'Rows remaining after predicate evaluation - the useful rows' },
  { key: 'LateMaterializeSkipRows',         label: 'Late Mat Skip',      source: 'unique', type: 'rows',      group: 'Row Processing', headerClass: 'row-processing-header', description: 'Rows skipped by late materialization - reads filter columns first, then fetches remaining columns only for matching rows' },
  { key: 'ExprFilterTime',                  label: 'Expr Filter',        source: 'unique', type: 'time',      group: 'Row Processing', headerClass: 'row-processing-header', description: 'Time spent evaluating filter expressions on the data' },

  // === Iceberg V2 (delete file handling) ===
  { key: 'DeleteFilesPerScan',              label: 'Delete Files',       source: 'unique', type: 'number',    group: 'Iceberg V2', headerClass: 'iceberg-v2-header', description: 'Number of positional delete files applied - high count means table needs compaction' },
  { key: 'DeleteFileBuildTime',             label: 'Del Build Time',     source: 'unique', type: 'time',      group: 'Iceberg V2', headerClass: 'iceberg-v2-header', description: 'Time reading delete files and building row ID filters to exclude deleted rows' },

  // === Runtime Filters (join-pushed filters) ===
  { key: 'JoinRuntimeFilterInputRows',      label: 'RF Input',           source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows before applying runtime filters from joins' },
  { key: 'JoinRuntimeFilterOutputRows',     label: 'RF Output',          source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows after runtime filters - lower = more effective filtering' },
];

// Per-table sort state
const internalState = { data: [], sortColumn: null, sortDirection: 'asc', groupStartIndices: new Set() };
const externalState = { data: [], sortColumn: null, sortDirection: 'asc', groupStartIndices: new Set() };

/**
 * Main function to render the dashboard
 */
export function renderDashboard(summary, execution, connectorScans, dropZone, dashboard) {
  // Hide drop zone, show dashboard
  dropZone.classList.add('hidden');
  dashboard.classList.add('visible');

  const { internalScans, externalScans } = classifyScanOperators(connectorScans);

  // 1. Render Query Metadata
  renderQueryMeta(summary);

  // 2. Render Summary Cards (unified across all scan types)
  renderSummaryCards(internalScans, externalScans, execution);

  // 3. Render both tables
  const internalContainer = document.getElementById('internalTableContainer');
  const externalContainer = document.getElementById('externalTableContainer');

  if (internalScans.length > 0) {
    renderTableForConfig(internalScans, METRICS_CONFIG, 'tableHead', 'tableBody', internalState);
  }
  if (externalScans.length > 0) {
    renderTableForConfig(externalScans, EXTERNAL_METRICS_CONFIG, 'externalTableHead', 'externalTableBody', externalState);
  }

  // 4. Build sub-tabs to toggle between them
  renderScanSubtabs(internalScans.length, externalScans.length, internalContainer, externalContainer);
}

/**
 * Render pill sub-tabs for switching between internal/external scan tables
 */
function renderScanSubtabs(internalCount, externalCount, internalContainer, externalContainer) {
  const container = document.getElementById('scanSubtabs');
  container.innerHTML = '';

  // Remove stale separator if any
  const existingSeparator = document.getElementById('externalScanLabel');
  if (existingSeparator) existingSeparator.remove();

  // Single type — no tabs needed, just show the right table
  if (internalCount === 0 && externalCount === 0) {
    internalContainer.style.display = 'none';
    externalContainer.style.display = 'none';
    return;
  }
  if (internalCount > 0 && externalCount === 0) {
    internalContainer.style.display = '';
    externalContainer.style.display = 'none';
    return;
  }
  if (internalCount === 0 && externalCount > 0) {
    internalContainer.style.display = 'none';
    externalContainer.style.display = '';
    return;
  }

  // Both types — render pill tabs
  const tabs = [
    { id: 'internal', label: 'Internal', count: internalCount, el: internalContainer },
    { id: 'external', label: 'Iceberg / Hive', count: externalCount, el: externalContainer },
  ];

  function activate(activeId) {
    container.querySelectorAll('.scan-subtab').forEach(b => b.classList.remove('active'));
    container.querySelector(`[data-scan-tab="${activeId}"]`).classList.add('active');
    internalContainer.style.display = activeId === 'internal' ? '' : 'none';
    externalContainer.style.display = activeId === 'external' ? '' : 'none';
  }

  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'scan-subtab';
    btn.dataset.scanTab = tab.id;
    btn.innerHTML = `${tab.label}<span class="subtab-count">(${tab.count})</span>`;
    btn.addEventListener('click', () => activate(tab.id));
    container.appendChild(btn);
  });

  // Default to internal
  activate('internal');
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
function renderSummaryCards(internalScans, externalScans, execution) {
  const allScans = [...internalScans, ...externalScans];

  // Calculate totals - BytesRead for internal, AppIOBytesRead for external
  const totalBytesRead = sumMetric(internalScans, 'BytesRead', 'unique')
                       + sumMetric(externalScans, 'AppIOBytesRead', 'unique')
                       + sumMetric(externalScans, 'DataCacheReadBytes', 'unique');
  const totalRowsRead = sumMetric(allScans, 'RowsRead', 'unique');
  const totalRawRows = sumMetric(allScans, 'RawRowsRead', 'unique');

  const allocatedMemory = execution.QueryAllocatedMemoryUsage || 'N/A';
  const scanTime = execution.QueryCumulativeScanTime || 'N/A';

  const cards = [
    { label: 'Scan Operators', value: allScans.length, type: 'number' },
    { label: 'Scan Time', value: scanTime, type: 'time' },
    { label: 'Allocated Memory', value: allocatedMemory, type: 'bytes' },
    { label: 'Total Bytes Read', value: formatBytes(totalBytesRead), type: 'bytes' },
    { label: 'Rows Scanned', value: formatNumber(totalRawRows), type: 'rows' },
    { label: 'Rows Read', value: formatNumber(totalRowsRead), type: 'rows' },
  ];

  document.getElementById('scanSummaryCards').innerHTML = cards.map(c => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.type}">${c.value}</div>
    </div>
  `).join('');
}

/**
 * Render Data Table with Grouped Headers (config-driven)
 */
function renderTableForConfig(scans, metricsConfig, theadId, tbodyId, state) {
  const thead = document.getElementById(theadId);

  // Store data in state for sorting
  state.data = scans;

  // Clear existing content
  thead.innerHTML = '';

  // =============================================
  // ROW 1: Group Headers (spans multiple columns)
  // =============================================
  const groupHeaderRow = document.createElement('tr');
  groupHeaderRow.className = 'group-header-row';

  let currentGroup = null;
  let currentHeaderClass = null;
  let colspan = 0;
  let groupCells = [];

  // Track which columns start a new group (for border styling)
  state.groupStartIndices = new Set();

  metricsConfig.forEach((col, idx) => {
    if (col.group !== currentGroup) {
      // Save the previous group if it existed
      if (colspan > 0) {
        groupCells.push({ group: currentGroup, colspan, headerClass: currentHeaderClass });
      }
      // Track the start of a new group
      if (col.group !== null) {
        state.groupStartIndices.add(idx);
      }
      currentGroup = col.group;
      currentHeaderClass = col.headerClass || null;
      colspan = 1;
    } else {
      colspan++;
    }
  });
  // Don't forget the last group
  if (colspan > 0) {
    groupCells.push({ group: currentGroup, colspan, headerClass: currentHeaderClass });
  }

  // Build the group header row
  // Count leading sticky columns
  let stickyCount = 0;
  while (stickyCount < metricsConfig.length && metricsConfig[stickyCount].sticky) {
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
        // Add headerClass if present
        if (cell.headerClass) {
          th.classList.add(cell.headerClass);
        }
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
        // Add headerClass if present
        if (cell.headerClass) {
          th.classList.add(cell.headerClass);
        }
      }
      groupHeaderRow.appendChild(th);
    }
  });

  // =============================================
  // ROW 2: Individual Column Headers (sortable)
  // =============================================
  const columnHeaderRow = document.createElement('tr');

  metricsConfig.forEach((col, idx) => {
    const th = document.createElement('th');
    th.dataset.col = idx;
    th.dataset.key = col.key;
    th.textContent = col.label;

    // Add tooltip if description exists
    if (col.description) {
      th.dataset.tooltip = col.description;
      th.classList.add('has-tooltip');
    }

    // Add group-start class for left border
    if (state.groupStartIndices.has(idx)) {
      th.classList.add('group-start');
    }

    // Add sticky class for fixed columns
    if (col.sticky) {
      th.classList.add('sticky-col');
    }

    // Add click handler for sorting (closure captures config and state)
    th.addEventListener('click', () => sortTableForConfig(th, metricsConfig, theadId, tbodyId, state));

    columnHeaderRow.appendChild(th);
  });

  // Append both rows to thead
  thead.appendChild(groupHeaderRow);
  thead.appendChild(columnHeaderRow);

  // Build body rows
  renderTableBodyForConfig(scans, metricsConfig, tbodyId, state);
}

/**
 * Compute skew ratio from max/min values
 */
/**
 * Compute skew as max / average (displayed metric values are averages across instances)
 */
function computeSkew(scan, metricKey) {
  const maxKey = `__MAX_OF_${metricKey}`;
  const maxVal = parseNumericValue(scan.commonMetrics[maxKey] || scan.uniqueMetrics[maxKey]);
  const avgVal = parseNumericValue(scan.commonMetrics[metricKey] || scan.uniqueMetrics[metricKey]);

  if (avgVal === 0 || isNaN(avgVal) || isNaN(maxVal)) {
    return { ratio: 1, max: maxVal, avg: avgVal };
  }
  return { ratio: maxVal / avgVal, max: maxVal, avg: avgVal };
}

/**
 * Assess compaction health for an external (Iceberg) scan operator
 */
function computeCompactionHealth(scan) {
  const reasons = [];
  let worstSeverity = 'ok';

  const escalate = (sev) => {
    const order = { ok: 0, recommended: 1, urgent: 2 };
    if (order[sev] > order[worstSeverity]) worstSeverity = sev;
  };

  // 1. Delete files
  const deleteFiles = parseNumericValue(scan.uniqueMetrics['DeleteFilesPerScan']);
  if (!isNaN(deleteFiles)) {
    let sev = 'ok';
    let detail = 'OK: \u2264 10';
    if (deleteFiles > 30) { sev = 'urgent'; detail = 'Recommended: \u2264 10'; }
    else if (deleteFiles > 10) { sev = 'recommended'; detail = 'Recommended: \u2264 10'; }
    escalate(sev);
    reasons.push({ label: 'Delete Files', value: String(deleteFiles), detail, severity: sev });
  }

  // 2. Average file size — skip for tiny tables (< 1 MB total) or single range
  const scanRanges = parseNumericValue(scan.uniqueMetrics['ScanRanges']);
  const scanRangesSize = parseNumericValue(scan.uniqueMetrics['ScanRangesSize']);
  const MB = 1024 * 1024;
  if (scanRanges > 1 && scanRangesSize > MB) {
    const avgSize = scanRangesSize / scanRanges;
    let sev = 'ok';
    let detail = 'OK: \u2265 64 MB';
    if (avgSize < 10 * MB) { sev = 'urgent'; detail = 'Recommended: \u2265 64 MB'; }
    else if (avgSize < 64 * MB) { sev = 'recommended'; detail = 'Recommended: \u2265 64 MB'; }
    escalate(sev);
    reasons.push({ label: 'Avg File Size', value: formatBytes(avgSize), detail, severity: sev });
  }

  // 3. File open overhead — skip for tiny tables
  const openFile = parseNumericValue(scan.uniqueMetrics['OpenFile']);
  const scanTime = parseNumericValue(scan.uniqueMetrics['ScanTime']);
  if (scanTime > 0.001 && openFile > 0 && scanRanges > 1) {
    const pct = (openFile / scanTime) * 100;
    let sev = 'ok';
    let detail = 'OK: \u2264 10%';
    if (pct > 30) { sev = 'urgent'; detail = 'Recommended: \u2264 10%'; }
    else if (pct > 10) { sev = 'recommended'; detail = 'Recommended: \u2264 10%'; }
    escalate(sev);
    reasons.push({ label: 'Open File / Scan Time', value: pct.toFixed(1) + '%', detail, severity: sev });
  }

  return { severity: worstSeverity, reasons };
}

/**
 * Format skew ratio for display
 */
function formatSkewRatio(ratio) {
  if (ratio < 1.1) return '1x';
  if (ratio < 10) return ratio.toFixed(1) + 'x';
  return Math.round(ratio) + 'x';
}

/**
 * Get skew severity class
 */
function getSkewClass(ratio) {
  if (ratio <= 2) return 'skew-ok';
  if (ratio <= 10) return 'skew-warning';
  return 'skew-danger';
}

/**
 * Render table body rows (config-driven)
 */
function renderTableBodyForConfig(scans, metricsConfig, tbodyId, state) {
  const tbody = document.getElementById(tbodyId);

  tbody.innerHTML = scans.map(scan => {
    // Pre-compute values needed for percentages
    const scanTime = parseNumericValue(scan.uniqueMetrics.ScanTime);

    const cells = metricsConfig.map((col, idx) => {
      // Get value based on source type
      let value;
      if (col.source === 'meta') {
        value = scan[col.key];
      } else if (col.source === 'common') {
        value = scan.commonMetrics[col.key];
      } else if (col.source === 'unique') {
        value = scan.uniqueMetrics[col.key];
      } else if (col.source === 'computed') {
        // Handle computed values
        if (col.key === 'OperatorSkew') {
          value = computeSkew(scan, 'OperatorTotalTime');
        } else if (col.key === 'ScanSkew') {
          value = computeSkew(scan, 'ScanTime');
        } else if (col.key === 'MaxScanTime') {
          value = scan.uniqueMetrics['__MAX_OF_ScanTime'] || null;
        } else if (col.key === 'TotalBytesRead') {
          const cacheBytes = parseNumericValue(scan.uniqueMetrics['DataCacheReadBytes']);
          const remoteBytes = parseNumericValue(scan.uniqueMetrics['AppIOBytesRead']);
          value = formatBytes(cacheBytes + remoteBytes);
        } else if (col.key === 'CacheHitRate') {
          const cacheBytes = parseNumericValue(scan.uniqueMetrics['DataCacheReadBytes']);
          const remoteBytes = parseNumericValue(scan.uniqueMetrics['FSIOBytesRead']);
          const total = cacheBytes + remoteBytes;
          value = total > 0 ? ((cacheBytes / total) * 100) : null;
        } else if (col.key === 'CompressionRatio') {
          const compressed = parseNumericValue(scan.uniqueMetrics['RequestBytesRead']);
          const uncompressed = parseNumericValue(scan.uniqueMetrics['RequestBytesReadUncompressed']);
          value = compressed > 0 ? (uncompressed / compressed) : null;
        } else if (col.key === 'AvgFileSize') {
          const ranges = parseNumericValue(scan.uniqueMetrics['ScanRanges']);
          const size = parseNumericValue(scan.uniqueMetrics['ScanRangesSize']);
          value = ranges > 0 ? formatBytes(size / ranges) : null;
        } else if (col.key === 'RowGroupFilterRate') {
          const total = parseNumericValue(scan.uniqueMetrics['TotalRowGroups']);
          const filtered = parseNumericValue(scan.uniqueMetrics['FilteredRowGroups']);
          value = total > 0 ? ((filtered / total) * 100) : null;
        } else if (col.key === 'CompactionHealth') {
          value = computeCompactionHealth(scan);
        }
      }

      // Apply styling based on type
      let displayValue = value ?? '-';
      let classNames = [];
      let titleText = String(value || '');

      // Add group-start class for left border
      if (state.groupStartIndices.has(idx)) {
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
          if (typeof displayValue === 'string' && displayValue.length > 50) {
            titleText = displayValue;
            displayValue = displayValue.substring(0, 50) + '...';
          }
          break;
        case 'bytes':
          classNames.push('number', 'bytes');
          break;
        case 'time':
          classNames.push('number', 'time');
          break;
        case 'timeWithScanPct':
          classNames.push('number', 'time');
          if (value && value !== '-' && scanTime > 0) {
            const timeVal = parseNumericValue(value);
            const pct = ((timeVal / scanTime) * 100).toFixed(1);
            displayValue = `${value} <span class="time-pct">(${pct}%)</span>`;
          }
          break;
        case 'skew':
          classNames.push('number', 'skew');
          if (value && typeof value === 'object') {
            const skewClass = getSkewClass(value.ratio);
            classNames.push(skewClass);
            displayValue = formatSkewRatio(value.ratio);
            titleText = `Max: ${value.max.toFixed(6)}s, Avg: ${value.avg.toFixed(6)}s`;
          } else {
            displayValue = '-';
          }
          break;
        case 'pct':
          classNames.push('number');
          if (value !== null && value !== undefined) {
            displayValue = `${value.toFixed(1)}%`;
            titleText = `${value.toFixed(2)}%`;
          } else {
            displayValue = '-';
          }
          break;
        case 'ratio':
          classNames.push('number');
          if (value !== null && value !== undefined) {
            displayValue = `${value.toFixed(1)}x`;
            titleText = `${value.toFixed(2)}x`;
          } else {
            displayValue = '-';
          }
          break;
        case 'health':
          classNames.push('health-cell');
          if (value && typeof value === 'object') {
            const labels = { ok: 'OK', recommended: 'Recommended', urgent: 'Urgent' };
            classNames.push(`health-${value.severity}`);
            classNames.push('has-health-popup');
            displayValue = labels[value.severity];
            titleText = '';
            // Store reasons as data attribute for popup
            col._healthData = null; // handled via event delegation
          } else {
            displayValue = '-';
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
        displayValue = `<span class="node-link" data-node-id="${value}">${displayValue}</span>`;
      }

      // Add health data attribute for popup
      const healthAttr = (col.type === 'health' && value && value.reasons)
        ? ` data-health='${JSON.stringify(value)}'`
        : '';

      return `<td class="${classNames.join(' ')}" title="${titleText}"${healthAttr}>${displayValue}</td>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  // Add click handlers for node links
  setupNodeLinkHandlers(tbody, 'scan');
}

/**
 * Sort table by column (scoped to specific table)
 */
function sortTableForConfig(th, metricsConfig, theadId, tbodyId, state) {
  const key = th.dataset.key;
  const colIndex = parseInt(th.dataset.col);
  const config = metricsConfig[colIndex];

  // Toggle direction if same column
  if (state.sortColumn === key) {
    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortColumn = key;
    state.sortDirection = 'asc';
  }

  // Update header styling (scoped to this table's thead)
  document.querySelectorAll(`#${theadId} th`).forEach(t => {
    t.classList.remove('sorted-asc', 'sorted-desc');
  });
  th.classList.add(state.sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

  // Sort the data
  state.data.sort((a, b) => {
    let valA, valB;

    // Handle computed values
    if (config.source === 'computed') {
      if (key === 'OperatorSkew') {
        valA = computeSkew(a, 'OperatorTotalTime').ratio;
        valB = computeSkew(b, 'OperatorTotalTime').ratio;
      } else if (key === 'ScanSkew') {
        valA = computeSkew(a, 'ScanTime').ratio;
        valB = computeSkew(b, 'ScanTime').ratio;
      } else if (key === 'MaxScanTime') {
        valA = parseNumericValue(a.uniqueMetrics['__MAX_OF_ScanTime']);
        valB = parseNumericValue(b.uniqueMetrics['__MAX_OF_ScanTime']);
      } else if (key === 'TotalBytesRead') {
        valA = parseNumericValue(a.uniqueMetrics['DataCacheReadBytes']) + parseNumericValue(a.uniqueMetrics['AppIOBytesRead']);
        valB = parseNumericValue(b.uniqueMetrics['DataCacheReadBytes']) + parseNumericValue(b.uniqueMetrics['AppIOBytesRead']);
      } else if (key === 'CacheHitRate') {
        const cA = parseNumericValue(a.uniqueMetrics['DataCacheReadBytes']), rA = parseNumericValue(a.uniqueMetrics['FSIOBytesRead']);
        const cB = parseNumericValue(b.uniqueMetrics['DataCacheReadBytes']), rB = parseNumericValue(b.uniqueMetrics['FSIOBytesRead']);
        valA = (cA + rA) > 0 ? cA / (cA + rA) : 0;
        valB = (cB + rB) > 0 ? cB / (cB + rB) : 0;
      } else if (key === 'CompressionRatio') {
        const compA = parseNumericValue(a.uniqueMetrics['RequestBytesRead']);
        const compB = parseNumericValue(b.uniqueMetrics['RequestBytesRead']);
        valA = compA > 0 ? parseNumericValue(a.uniqueMetrics['RequestBytesReadUncompressed']) / compA : 0;
        valB = compB > 0 ? parseNumericValue(b.uniqueMetrics['RequestBytesReadUncompressed']) / compB : 0;
      } else if (key === 'AvgFileSize') {
        const rA = parseNumericValue(a.uniqueMetrics['ScanRanges']), rB = parseNumericValue(b.uniqueMetrics['ScanRanges']);
        valA = rA > 0 ? parseNumericValue(a.uniqueMetrics['ScanRangesSize']) / rA : 0;
        valB = rB > 0 ? parseNumericValue(b.uniqueMetrics['ScanRangesSize']) / rB : 0;
      } else if (key === 'RowGroupFilterRate') {
        const tA = parseNumericValue(a.uniqueMetrics['TotalRowGroups']), tB = parseNumericValue(b.uniqueMetrics['TotalRowGroups']);
        valA = tA > 0 ? parseNumericValue(a.uniqueMetrics['FilteredRowGroups']) / tA : 0;
        valB = tB > 0 ? parseNumericValue(b.uniqueMetrics['FilteredRowGroups']) / tB : 0;
      } else if (key === 'CompactionHealth') {
        const severityOrder = { ok: 0, recommended: 1, urgent: 2 };
        valA = severityOrder[computeCompactionHealth(a).severity];
        valB = severityOrder[computeCompactionHealth(b).severity];
      }
    } else {
      const sourceA = config.source === 'meta' ? a : (config.source === 'common' ? a.commonMetrics : a.uniqueMetrics);
      const sourceB = config.source === 'meta' ? b : (config.source === 'common' ? b.commonMetrics : b.uniqueMetrics);

      valA = sourceA[key] ?? '';
      valB = sourceB[key] ?? '';

      // Parse numeric values from strings like "18.636 KB" or "1.592ms"
      if (config.type !== 'string' && config.type !== 'predicate') {
        valA = parseNumericValue(valA);
        valB = parseNumericValue(valB);
      }
    }

    // Compare
    if (valA < valB) return state.sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return state.sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Re-render table body
  renderTableBodyForConfig(state.data, metricsConfig, tbodyId, state);
}
