/**
 * Comparison render layer
 *
 * Owns all DOM rendering + diff logic for the Query Comparison tab.
 * compare.js handles data extraction / state / load / share and calls into here.
 *
 * Tier 1 (this file, so far): query-wide aggregate cards
 *   - Planning vs Execution headline
 *   - Planning phases
 *   - Execution time
 *   - Memory
 *   - Scan summary
 *   - Join summary
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes, formatTime } from './utils.js';
import { METRICS_CONFIG, EXTERNAL_METRICS_CONFIG, getScanRawValue } from './scanRender.js';
import { JOIN_METRICS_CONFIG } from './joinRender.js';
import { classifyScanOperators } from './scanParser.js';

/**
 * Calculate change percentage and classification between two values.
 * @param {number} baselineNum
 * @param {number} optimizedNum
 * @param {boolean} lowerIsBetter
 * @returns {{ change:number, improved:boolean, changeClass:string, changeSymbol:string, changeArrow:string }}
 */
export function calculateChange(baselineNum, optimizedNum, lowerIsBetter) {
  const change = baselineNum > 0 ? ((optimizedNum - baselineNum) / baselineNum) * 100 : 0;
  const improved = lowerIsBetter ? change < 0 : change > 0;
  const changeClass = Math.abs(change) < 1 ? 'neutral' : (improved ? 'improved' : 'regressed');
  const changeSymbol = change > 0 ? '+' : '';

  let changeArrow;
  if (Math.abs(change) < 1) {
    changeArrow = '≈'; // ≈
  } else if (change < 0) {
    changeArrow = '↓'; // ↓
  } else {
    changeArrow = '↑'; // ↑
  }

  return { change, improved, changeClass, changeSymbol, changeArrow };
}

/**
 * Format a numeric value for display based on the card's declared format.
 */
function formatValue(val, format) {
  if (format === 'bytes') return formatBytes(val);
  if (format === 'number') return formatNumber(val);
  if (format === 'time') return formatTime(val);
  if (format === 'count') return String(val);
  return val;
}

/**
 * Build one compact comparison row: label · two thin bars (baseline grey / optimized
 * colored) · "base → opt" values · % delta. The shared row component for every section
 * except the headline (big numbers).
 *
 * @param {Object} r - { label, base, opt, format, lowerIsBetter=true, indent, muted, tooltip, scaleMax }
 *   scaleMax: when provided, bars scale to this shared max (e.g. planning phases).
 *             when omitted, the row self-scales to max(base, opt).
 */
function compareRow(r) {
  const lowerIsBetter = r.lowerIsBetter !== false; // default true
  const base = r.base || 0;
  const opt = r.opt || 0;

  const calc = calculateChange(base, opt, lowerIsBetter);
  const { change, changeSymbol, changeArrow } = calc;
  // noVerdict: metric has no inherently "better" direction (e.g. fragment count) —
  // show the change neutral (grey) but keep the direction arrow.
  const changeClass = r.noVerdict ? 'neutral' : calc.changeClass;

  // Bars are only honest when a shared scale is meaningful (additive breakdowns like
  // Planning Phases). For non-additive metrics, self-scaled bars would invite invalid
  // cross-row comparison, so callers pass showBars:false and we render numbers only.
  const showBars = r.showBars !== false;

  const classes = ['cmp-row', changeClass];
  if (!showBars) classes.push('no-bars');
  if (r.indent) classes.push('indent');
  if (r.muted) classes.push('muted');
  const tooltipAttr = r.tooltip ? ` data-tooltip="${r.tooltip}"` : '';

  let barsHTML = '';
  if (showBars) {
    const max = r.scaleMax || Math.max(base, opt) || 1;
    const bPct = (base / max) * 100;
    const oPct = (opt / max) * 100;
    barsHTML = `
      <div class="cmp-bars">
        <div class="cmp-bar-track"><div class="cmp-bar baseline" style="width: ${bPct}%"></div></div>
        <div class="cmp-bar-track"><div class="cmp-bar optimized" style="width: ${oPct}%"></div></div>
      </div>`;
  }

  return `
    <div class="${classes.join(' ')}"${tooltipAttr}>
      <span class="cmp-label">${r.label}</span>
      ${barsHTML}
      <span class="cmp-values"><span class="cv-base">${formatValue(base, r.format)}</span><span class="cv-arrow">→</span><span class="cv-opt">${formatValue(opt, r.format)}</span></span>
      <span class="cmp-delta ${changeClass}"><span class="change-arrow">${changeArrow}</span>${changeSymbol}${change.toFixed(1)}%</span>
    </div>
  `;
}

/**
 * Render a self-scaled compact comparison list (Execution Time, Memory, Scan, Join).
 * Each row scales independently — these metrics measure different things and don't
 * share a meaningful scale (e.g. cumulative CPU time dwarfs elapsed wall time).
 */
function renderCompareRows(rows) {
  return `<div class="cmp-list">${rows.map(r => compareRow({ ...r, showBars: false })).join('')}</div>`;
}

/**
 * Count execution-shape structure from a raw Execution object:
 * fragments, pipelines, and total fragment instances.
 */
function executionShape(execution) {
  let fragments = 0, pipelines = 0, instances = 0;
  for (const key in execution) {
    if (!/^Fragment \d+$/.test(key)) continue;
    fragments++;
    const frag = execution[key];
    instances += parseInt(frag.InstanceNum, 10) || 0;
    for (const pk in frag) {
      if (/^Pipeline \(id=\d+\)$/.test(pk)) pipelines++;
    }
  }
  return { fragments, pipelines, instances };
}

/** Grand-total planning time = sum of top-level planner phases (matches Overview tab). */
function planningTotal(planner) {
  if (!planner) return 0;
  return (planner.parser || 0) + (planner.total || 0) + (planner.pending || 0) +
         (planner.prepare || 0) + (planner.deploy || 0);
}

/**
 * Render the Planning vs Execution headline: a stacked split-bar (baseline above,
 * optimized below) scaled to the larger total, plus Total / Planning / Execution cards.
 */
function renderPlanExecHeadline(baseline, optimized) {
  const bPlan = planningTotal(baseline.plannerTiming);
  const oPlan = planningTotal(optimized.plannerTiming);
  const bExec = parseNumericValue(baseline.execution.QueryExecutionWallTime);
  const oExec = parseNumericValue(optimized.execution.QueryExecutionWallTime);
  const bTotal = bPlan + bExec;
  const oTotal = oPlan + oExec;
  const maxTotal = Math.max(bTotal, oTotal) || 1;

  // One stacked split-bar per side, scaled to the larger total.
  const splitBar = (planSec, execSec, total, typeLabel) => {
    const widthPct = (total / maxTotal) * 100;
    const planShare = total > 0 ? (planSec / total) * 100 : 0;
    const execShare = total > 0 ? (execSec / total) * 100 : 0;
    const planPctOfTotal = total > 0 ? Math.round((planSec / total) * 100) : 0;
    const execPctOfTotal = total > 0 ? Math.round((execSec / total) * 100) : 0;
    return `
      <div class="plan-exec-row">
        <span class="plan-exec-rowlabel ${typeLabel}">${typeLabel === 'baseline' ? '📊 Baseline' : '🚀 Optimized'}</span>
        <div class="plan-exec-track">
          <div class="plan-exec-fill" style="width: ${widthPct}%">
            <div class="plan-exec-seg planning" style="width: ${planShare}%"
                 data-tooltip="Planning: ${formatTime(planSec)} (${planPctOfTotal}%)"></div>
            <div class="plan-exec-seg execution" style="width: ${execShare}%"
                 data-tooltip="Execution: ${formatTime(execSec)} (${execPctOfTotal}%)"></div>
          </div>
        </div>
        <span class="plan-exec-rowtotal">${formatTime(total)}</span>
      </div>
    `;
  };

  const statsHTML = [
    { label: 'Total Time', base: bTotal, opt: oTotal, format: 'time' },
    { label: 'Planning', base: bPlan, opt: oPlan, format: 'time' },
    { label: 'Execution', base: bExec, opt: oExec, format: 'time' },
  ].map(statCard).join('');

  return `
    <div class="plan-exec-legend">
      <span class="legend-item"><span class="legend-swatch planning"></span> Planning</span>
      <span class="legend-item"><span class="legend-swatch execution"></span> Execution</span>
    </div>
    <div class="plan-exec-bars">
      ${splitBar(bPlan, bExec, bTotal, 'baseline')}
      ${splitBar(oPlan, oExec, oTotal, 'optimized')}
    </div>
    <div class="headline-stats">${statsHTML}</div>
  `;
}

/**
 * Big-number stat card: label, big optimized value, arrow + % delta, "was <baseline>".
 * item: { label, base, opt, format, lowerIsBetter=true, noVerdict }
 */
function statCard(item) {
  const lowerIsBetter = item.lowerIsBetter !== false;
  const calc = calculateChange(item.base || 0, item.opt || 0, lowerIsBetter);
  const cls = item.noVerdict ? 'neutral' : calc.changeClass;
  return `
    <div class="hstat ${cls}">
      <div class="hstat-label">${item.label}</div>
      <div class="hstat-value">${formatValue(item.opt || 0, item.format)}</div>
      <div class="hstat-delta ${cls}"><span class="change-arrow">${calc.changeArrow}</span> ${calc.changeSymbol}${calc.change.toFixed(1)}%</div>
      <div class="hstat-was">was ${formatValue(item.base || 0, item.format)}</div>
    </div>
  `;
}

/** Render a responsive grid of big-number stat cards (Scan/Join summaries). */
function renderStatCards(items) {
  return `<div class="stat-grid">${items.map(statCard).join('')}</div>`;
}

/**
 * Render the Planning Phases breakdown: phases top-to-bottom in execution order,
 * sub-phases indented under Planner Total, all bars on ONE shared scale so phase
 * dominance and ranking shifts are visible. Two bars per row (baseline grey, optimized colored).
 */
function renderPlanningPhases(baseline, optimized) {
  const bp = baseline.plannerTiming || {};
  const op = optimized.plannerTiming || {};

  // Sub-phases of Planner Total (only those present in either profile)
  const subDefs = [
    { label: 'Analyzer', key: 'analyzer' },
    { label: 'Transformer', key: 'transformer' },
    { label: 'Optimizer', key: 'optimizer' },
    { label: 'ExecPlanBuild', key: 'execPlanBuild' },
  ];
  const subRows = subDefs
    .filter(s => (bp[s.key] || 0) > 0 || (op[s.key] || 0) > 0)
    .map(s => ({ label: s.label, base: bp[s.key] || 0, opt: op[s.key] || 0, indent: true }));

  // Top-level phases in sequential order; sub-phases slotted under Planner Total
  const topRows = [
    { label: 'Parser', base: bp.parser || 0, opt: op.parser || 0 },
    { label: 'Planner Total', base: bp.total || 0, opt: op.total || 0, children: subRows },
    { label: 'Pending', base: bp.pending || 0, opt: op.pending || 0 },
    { label: 'Prepare', base: bp.prepare || 0, opt: op.prepare || 0 },
    { label: 'Deploy', base: bp.deploy || 0, opt: op.deploy || 0 },
  ];

  const rows = [];
  for (const r of topRows) {
    rows.push(r);
    if (r.children) rows.push(...r.children);
  }

  // Shared scale across every row so bar lengths are comparable phase-to-phase
  const scaleMax = Math.max(...rows.map(r => Math.max(r.base, r.opt)), 0) || 1;

  const rowHTML = rows
    .map(r => compareRow({ ...r, format: 'time', scaleMax }))
    .join('');

  return `<div class="cmp-list phases">${rowHTML}</div>`;
}

/**
 * Main Tier 1 render entry point.
 * @param {Object} data - { baseline, optimized } each with { summary, execution, scans, joinStats, totalActiveTime, plannerTiming }
 */
export function renderComparison(data) {
  const results = document.getElementById('compareResults');
  if (!results) return;
  results.classList.add('visible');

  const baseline = data.baseline;
  const optimized = data.optimized;

  // Query meta headers
  const metaHTML = (s) => `
    <span>Query ID:</span><strong>${s['Query ID'] || 'N/A'}</strong>
    <span>Duration:</span><strong>${s['Total'] || 'N/A'}</strong>
  `;
  document.getElementById('compareMetaBaseline').innerHTML = metaHTML(baseline.summary);
  document.getElementById('compareMetaOptimized').innerHTML = metaHTML(optimized.summary);

  // Planning vs Execution headline
  document.getElementById('comparePlanExec').innerHTML = renderPlanExecHeadline(baseline, optimized);

  // Planning phases — sequential, nested, shared-scale breakdown
  document.getElementById('comparePlanningCards').innerHTML = renderPlanningPhases(baseline, optimized);

  // Execution time — independent lenses, each row self-scales (no shared scale:
  // cumulative CPU time dwarfs elapsed wall time, mixing them would mislead).
  const num = (exec, key) => parseNumericValue(exec[key]);
  document.getElementById('compareTimeCards').innerHTML = renderCompareRows([
    { label: 'Wall Time', base: num(baseline.execution, 'QueryExecutionWallTime'), opt: num(optimized.execution, 'QueryExecutionWallTime'), format: 'time' },
    { label: 'Active Time', base: baseline.totalActiveTime, opt: optimized.totalActiveTime, format: 'time' },
    { label: 'Operator Time', base: num(baseline.execution, 'QueryCumulativeOperatorTime'), opt: num(optimized.execution, 'QueryCumulativeOperatorTime'), format: 'time' },
    { label: 'Scan Time', base: num(baseline.execution, 'QueryCumulativeScanTime'), opt: num(optimized.execution, 'QueryCumulativeScanTime'), format: 'time' },
    { label: 'Network Time', base: num(baseline.execution, 'QueryCumulativeNetworkTime'), opt: num(optimized.execution, 'QueryCumulativeNetworkTime'), format: 'time' },
    { label: 'CPU Time', base: num(baseline.execution, 'QueryCumulativeCpuTime'), opt: num(optimized.execution, 'QueryCumulativeCpuTime'), format: 'time' },
  ]);

  // Memory — Peak/Sum/Spill are the signals that matter (peak drives mem_limit/OOM/spill).
  // Allocated/Deallocated dropped: they're cumulative churn that scales with plan shape,
  // not a footprint — diffing them is misleading.
  document.getElementById('compareMemoryCards').innerHTML = renderCompareRows([
    { label: 'Peak Memory / Node', base: num(baseline.execution, 'QueryPeakMemoryUsagePerNode'), opt: num(optimized.execution, 'QueryPeakMemoryUsagePerNode'), format: 'bytes' },
    { label: 'Sum Memory', base: num(baseline.execution, 'QuerySumMemoryUsage'), opt: num(optimized.execution, 'QuerySumMemoryUsage'), format: 'bytes' },
    { label: 'Spill Bytes', base: num(baseline.execution, 'QuerySpillBytes'), opt: num(optimized.execution, 'QuerySpillBytes'), format: 'bytes' },
  ]);

  // Execution shape — structural counts. Directionless (fewer fragments isn't strictly
  // "better"), so render neutral with a direction arrow rather than a good/bad verdict.
  const bShape = executionShape(baseline.execution);
  const oShape = executionShape(optimized.execution);
  document.getElementById('compareShapeCards').innerHTML = renderCompareRows([
    { label: 'Fragments', base: bShape.fragments, opt: oShape.fragments, format: 'count', noVerdict: true },
    { label: 'Pipelines', base: bShape.pipelines, opt: oShape.pipelines, format: 'count', noVerdict: true },
    { label: 'Instances', base: bShape.instances, opt: oShape.instances, format: 'count', noVerdict: true },
  ]);

  // Scan summary (query-wide aggregates)
  const totalBytes = (scans) => sumMetric(scans, 'BytesRead', 'unique') + sumMetric(scans, 'AppIOBytesRead', 'unique') + sumMetric(scans, 'DataCacheReadBytes', 'unique');
  document.getElementById('compareScanCards').innerHTML = renderStatCards([
    { label: 'Scan Operators', base: baseline.scans.length, opt: optimized.scans.length, format: 'count' },
    { label: 'Scan Time', base: num(baseline.execution, 'QueryCumulativeScanTime'), opt: num(optimized.execution, 'QueryCumulativeScanTime'), format: 'time' },
    { label: 'Total Bytes Read', base: totalBytes(baseline.scans), opt: totalBytes(optimized.scans), format: 'bytes' },
    { label: 'Rows Scanned', base: sumMetric(baseline.scans, 'RawRowsRead', 'unique'), opt: sumMetric(optimized.scans, 'RawRowsRead', 'unique'), format: 'number' },
    { label: 'Rows Read', base: sumMetric(baseline.scans, 'RowsRead', 'unique'), opt: sumMetric(optimized.scans, 'RowsRead', 'unique'), format: 'number' },
  ]);

  // Join summary (query-wide aggregates)
  const bj = baseline.joinStats;
  const oj = optimized.joinStats;
  document.getElementById('compareJoinCards').innerHTML = renderStatCards([
    { label: 'Join Operators', base: bj.totalJoins, opt: oj.totalJoins, format: 'count' },
    { label: 'Hash Table Memory', base: bj.totalHashTableMemoryBytes, opt: oj.totalHashTableMemoryBytes, format: 'bytes' },
    { label: 'Max Hash Table Memory', base: bj.maxHashTableMemoryBytes, opt: oj.maxHashTableMemoryBytes, format: 'bytes' },
    { label: 'Rows Spilled', base: bj.totalRowsSpilled, opt: oj.totalRowsSpilled, format: 'number' },
    { label: 'Total Join Time', base: bj.totalTimeSeconds, opt: oj.totalTimeSeconds, format: 'time' },
    { label: 'Total Build Time', base: bj.totalBuildTimeSeconds, opt: oj.totalBuildTimeSeconds, format: 'time' },
    { label: 'Total Probe Time', base: bj.totalProbeTimeSeconds, opt: oj.totalProbeTimeSeconds, format: 'time' },
  ]);

  // Node-vs-node comparators (Tier 2)
  setupScanCompare(baseline.scans, optimized.scans);
  setupJoinCompare(baseline.joins, optimized.joins);
}

// ---------------------------------------------------------------------------
// Node-vs-node comparison (Tier 2): pick one node per side, diff their stats.
// No automatic matching — the user owns which pairing is meaningful.
// ---------------------------------------------------------------------------

const scanLabel = (s) => `#${s.planNodeId} — ${(s.uniqueMetrics && s.uniqueMetrics.Table) || s.operatorType || 'scan'}`;
const joinLabel = (j) => `#${j.planNodeId} — ${[j.joinType, j.distributionMode].filter(Boolean).join(' ')}`.trim();

/** Raw value getter for a join node given its column config (no computed columns). */
function getJoinRawValue(join, col) {
  if (col.source === 'summary') return join[col.key];
  if (col.source === 'probe') return (join.probe || {})[col.key];
  if (col.source === 'build') return (join.build || {})[col.key];
  return undefined;
}

const formatSkew = (ratio) => ratio < 1.1 ? '1x' : (ratio < 10 ? ratio.toFixed(1) + 'x' : Math.round(ratio) + 'x');

/** Whether a column can be diffed numerically (identity/text/health cannot).
 * planNodeId is identity (the node's id), so it shows in the value rows but gets no Δ. */
const isComparable = (col) =>
  col.key !== 'planNodeId' && col.source !== 'meta' && !['string', 'predicate', 'health'].includes(col.type);

/** Derive a number from a raw cell value for delta computation. */
function deriveNumeric(raw, col) {
  if (raw == null) return 0;
  if (typeof raw === 'object') return raw.ratio || 0; // skew {ratio,...}
  if (typeof raw === 'number') return raw;            // pct / ratio computed
  return parseNumericValue(raw);
}

/** Format a raw cell value + return the td class, faithful to the Scan/Join tabs. */
function formatCmpCell(raw, col) {
  switch (col.type) {
    case 'string': return { display: raw || '-', cls: 'table-name' };
    case 'predicate': return { display: (raw == null || raw === '') ? '-' : String(raw), cls: 'predicate' };
    case 'health': {
      const labels = { ok: 'OK', recommended: 'Recommended', urgent: 'Urgent' };
      return { display: (raw && raw.severity) ? labels[raw.severity] : '-', cls: '' };
    }
    case 'skew': return { display: (raw && typeof raw === 'object') ? formatSkew(raw.ratio) : '-', cls: 'number' };
    case 'pct': return { display: (raw == null) ? '-' : `${raw.toFixed(1)}%`, cls: 'number' };
    case 'ratio': return { display: (raw == null) ? '-' : `${raw.toFixed(1)}x`, cls: 'number' };
    case 'bytes': return { display: formatBytes(parseNumericValue(raw)), cls: 'number bytes' };
    case 'time':
    case 'timeWithScanPct':
    case 'timeWithPct': return { display: formatTime(parseNumericValue(raw)), cls: 'number' };
    case 'rows':
    case 'number':
    default:
      if (col.source === 'meta') return { display: (raw == null ? '-' : String(raw)), cls: 'number' };
      return { display: formatNumber(parseNumericValue(raw)), cls: 'number' };
  }
}

/**
 * Build the 3-row head-to-head table (Baseline / Optimized / Δ) using the Scan/Join
 * tab column config + a raw-value getter, reusing the tab's global table styles.
 */
function buildComparisonTable(config, baseNode, optNode, getRawValue) {
  // Group-header row (spans), built from consecutive same-group columns
  const groups = [];
  let cur, span = 0, hclass = null;
  config.forEach(col => {
    if (col.group !== cur) {
      if (span > 0) groups.push({ group: cur, span, hclass });
      cur = col.group; hclass = col.headerClass || null; span = 1;
    } else span++;
  });
  if (span > 0) groups.push({ group: cur, span, hclass });
  const groupCells = groups.map(g => {
    const cls = g.group ? (g.hclass || '') : 'group-spacer';
    return `<th colspan="${g.span}" class="${cls}">${g.group || ''}</th>`;
  }).join('');
  const groupRow = `<tr class="group-header-row"><th class="sticky-col"></th>${groupCells}</tr>`;

  // Column-header row (group-start borders, tooltips)
  let prev;
  const colCells = config.map(col => {
    const groupStart = col.group !== prev && col.group !== null;
    prev = col.group;
    const cls = groupStart ? 'group-start' : '';
    const tip = col.description ? ` data-tooltip="${col.description.replace(/"/g, '&quot;')}"` : '';
    return `<th class="${cls} has-tooltip"${tip}>${col.label}</th>`;
  }).join('');
  const colRow = `<tr><th class="sticky-col"></th>${colCells}</tr>`;

  // Body value rows
  const valueRow = (label, node, rowCls) => {
    let p;
    const cells = config.map(col => {
      const groupStart = col.group !== p && col.group !== null;
      p = col.group;
      const { display, cls } = formatCmpCell(getRawValue(node, col), col);
      return `<td class="${cls}${groupStart ? ' group-start' : ''}">${display}</td>`;
    }).join('');
    return `<tr class="${rowCls}"><td class="sticky-col cmp-rowlabel ${rowCls}">${label}</td>${cells}</tr>`;
  };

  // Δ row
  let pd;
  const deltaCells = config.map(col => {
    const groupStart = col.group !== pd && col.group !== null;
    pd = col.group;
    const gs = groupStart ? ' group-start' : '';
    if (!isComparable(col)) return `<td class="cmp-delta-cell${gs}">—</td>`;
    const bn = deriveNumeric(getRawValue(baseNode, col), col);
    const on = deriveNumeric(getRawValue(optNode, col), col);
    const { change, changeSymbol, changeArrow } = calculateChange(bn, on, true);
    return `<td class="cmp-delta-cell number${gs}"><span class="change-arrow">${changeArrow}</span>${changeSymbol}${change.toFixed(1)}%</td>`;
  }).join('');
  const deltaRow = `<tr class="cmp-delta-row"><td class="sticky-col cmp-rowlabel">Δ</td>${deltaCells}</tr>`;

  return `
    <div class="table-container cmp-table-container" tabindex="0">
      <table>
        <thead>${groupRow}${colRow}</thead>
        <tbody>${valueRow('Baseline', baseNode, 'cmp-base-row')}${valueRow('Optimized', optNode, 'cmp-opt-row')}${deltaRow}</tbody>
      </table>
    </div>
  `;
}

/** Wire the scan comparator: smart Native|Hive toggle + dropdowns + 3-row table. */
function setupScanCompare(baseScans, optScans) {
  const toggleEl = document.getElementById('scanTypeToggle');
  const bSel = document.getElementById('scanPickBaseline');
  const oSel = document.getElementById('scanPickOptimized');
  const detail = document.getElementById('scanNodeDetail');
  if (!toggleEl || !bSel || !oSel || !detail) return;

  const b = classifyScanOperators(baseScans);
  const o = classifyScanOperators(optScans);
  const types = [];
  if (b.internalScans.length || o.internalScans.length) {
    types.push({ label: 'Native', config: METRICS_CONFIG, base: b.internalScans, opt: o.internalScans });
  }
  if (b.externalScans.length || o.externalScans.length) {
    types.push({ label: 'Hive', config: EXTERNAL_METRICS_CONFIG, base: b.externalScans, opt: o.externalScans });
  }

  if (!types.length) {
    toggleEl.innerHTML = '';
    bSel.innerHTML = oSel.innerHTML = '';
    detail.innerHTML = '<p class="node-compare-empty">No scan nodes in these profiles.</p>';
    return;
  }

  let active = 0;
  const byNodeId = (x, y) => (parseInt(x.planNodeId, 10) || 0) - (parseInt(y.planNodeId, 10) || 0);

  const renderType = () => {
    const t = types[active];
    // Toggle only shown when both types exist
    toggleEl.innerHTML = types.length > 1
      ? types.map((tt, i) => `<button class="scan-type-btn ${i === active ? 'active' : ''}" data-i="${i}">${tt.label}</button>`).join('')
      : '';
    toggleEl.querySelectorAll('.scan-type-btn').forEach(btn =>
      btn.addEventListener('click', () => { active = parseInt(btn.dataset.i, 10); renderType(); }));

    const base = [...t.base].sort(byNodeId);
    const opt = [...t.opt].sort(byNodeId);
    bSel.innerHTML = base.map((n, i) => `<option value="${i}">${scanLabel(n)}</option>`).join('');
    oSel.innerHTML = opt.map((n, i) => `<option value="${i}">${scanLabel(n)}</option>`).join('');

    const renderTable = () => {
      if (!base.length || !opt.length) {
        detail.innerHTML = `<p class="node-compare-empty">No ${t.label.toLowerCase()} scans in ${!base.length ? 'the baseline' : 'the optimized'} profile.</p>`;
        return;
      }
      const bn = base[parseInt(bSel.value, 10) || 0];
      const on = opt[parseInt(oSel.value, 10) || 0];
      detail.innerHTML = buildComparisonTable(t.config, bn, on, getScanRawValue);
    };
    bSel.onchange = renderTable;
    oSel.onchange = renderTable;
    renderTable();
  };

  renderType();
}

/** Wire the join comparator: dropdowns + 3-row table (single column set). */
function setupJoinCompare(baseJoins, optJoins) {
  const bSel = document.getElementById('joinPickBaseline');
  const oSel = document.getElementById('joinPickOptimized');
  const detail = document.getElementById('joinNodeDetail');
  if (!bSel || !oSel || !detail) return;

  const byNodeId = (x, y) => (parseInt(x.planNodeId, 10) || 0) - (parseInt(y.planNodeId, 10) || 0);
  const base = [...baseJoins].sort(byNodeId);
  const opt = [...optJoins].sort(byNodeId);
  bSel.innerHTML = base.map((n, i) => `<option value="${i}">${joinLabel(n)}</option>`).join('');
  oSel.innerHTML = opt.map((n, i) => `<option value="${i}">${joinLabel(n)}</option>`).join('');

  const render = () => {
    if (!base.length || !opt.length) {
      detail.innerHTML = `<p class="node-compare-empty">No join nodes in ${!base.length ? 'the baseline' : 'the optimized'} profile.</p>`;
      return;
    }
    const bn = base[parseInt(bSel.value, 10) || 0];
    const on = opt[parseInt(oSel.value, 10) || 0];
    detail.innerHTML = buildComparisonTable(JOIN_METRICS_CONFIG, bn, on, getJoinRawValue);
  };
  bSel.onchange = render;
  oSel.onchange = render;
  render();
}

/** Wire the Summary/Scan/Join sub-tab switching. Called once on init. */
export function initCompareUI() {
  const btns = document.querySelectorAll('.compare-subtab-btn');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.compare-subpanel').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(`compareSub-${btn.dataset.subtab}`);
      if (target) target.classList.add('active');
    });
  });
}
