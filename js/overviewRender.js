/**
 * Overview tab rendering functions
 * Displays query summary, pipeline timeline, and quick stats
 */

import { formatTime } from './utils.js';

/**
 * Render the Overview dashboard
 */
export function renderOverview(summary, analysis, dropZone, dashboard) {
  // Hide drop zone, show dashboard
  dropZone.classList.add('hidden');
  dashboard.classList.add('visible');

  // 1. Render Query Summary
  renderQuerySummary(summary, analysis);

  // 2. Render Planning vs Execution bar (if planner data available)
  renderPlanningBar(analysis);

  // 3. Render Quick Stats (above pipeline timeline)
  renderQuickStats(analysis);

  // 4. Render Pipeline Timeline
  renderPipelineTimeline(analysis);
}

/**
 * Render Query Summary section
 */
function renderQuerySummary(summary, analysis) {
  const container = document.getElementById('overviewQueryMeta');

  const fields = [
    { label: 'Query ID', value: summary['Query ID'] },
    { label: 'Duration', value: summary['Total'] },
    { label: 'State', value: summary['Query State'] },
    { label: 'Fragments', value: analysis.fragments.length },
    { label: 'User', value: summary['User'] },
    { label: 'Database', value: summary['Default Db'] },
  ];

  container.innerHTML = fields.map(f => `
    <div class="meta-item">
      <label>${f.label}</label>
      <span>${f.value || 'N/A'}</span>
    </div>
  `).join('');
}

/**
 * Render Planning vs Execution bar with collapsible planner breakdown
 */
function renderPlanningBar(analysis) {
  const container = document.getElementById('planningBarContainer');
  if (!container) return;

  const planner = analysis.plannerTiming;
  if (!planner) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  // Planning time = sum of top-level phases (Parser + Total + Pending + Prepare + Deploy)
  const planningTime = planner.parser + planner.total + planner.pending + planner.prepare + planner.deploy;
  const executionTime = analysis.queryWallTime;
  const totalTime = planningTime + executionTime;

  if (totalTime === 0) {
    container.style.display = 'none';
    return;
  }

  const planningPct = (planningTime / totalTime) * 100;
  const executionPct = (executionTime / totalTime) * 100;

  // Determine if planning time is concerning (>30% of total)
  const planningWarning = planningPct > 30;

  // Build planner breakdown
  const breakdownHtml = buildPlannerBreakdown(planner);

  container.innerHTML = `
    <div class="planning-bar-wrapper">
      <div class="planning-bar-labels">
        <span class="planning-label${planningWarning ? ' warning' : ''}">Planning: ${formatTime(planningTime)} (${planningPct.toFixed(0)}%)</span>
        <span class="execution-label">Execution: ${formatTime(executionTime)} (${executionPct.toFixed(0)}%)</span>
      </div>
      <div class="planning-bar">
        <div class="planning-segment planning" style="width: ${planningPct}%" title="Planning: ${formatTime(planningTime)}"></div>
        <div class="planning-segment execution" style="width: ${executionPct}%" title="Execution: ${formatTime(executionTime)}"></div>
      </div>
      ${breakdownHtml}
    </div>
  `;

  // Wire up toggle
  const toggle = container.querySelector('.planner-breakdown-toggle');
  const wrapper = container.querySelector('.planner-breakdown-wrapper');
  if (toggle && wrapper) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('expanded');
      wrapper.classList.toggle('expanded');
    });
  }
}

/**
 * Build the collapsible planner phase breakdown HTML
 * Structure: Grand total, then Parser, Planner Total (with indented sub-phases), Pending, Prepare, Deploy
 * All bars are relative to grand total planning time.
 */
function buildPlannerBreakdown(planner) {
  const grandTotal = planner.parser + planner.total + planner.pending + planner.prepare + planner.deploy;
  if (grandTotal === 0) return '';

  // Top-level phases in display order
  const topPhases = [
    { label: 'Parser', value: planner.parser },
    { label: 'Planner Total', value: planner.total },
    { label: 'Pending', value: planner.pending },
    { label: 'Prepare', value: planner.prepare },
    { label: 'Deploy', value: planner.deploy },
  ];

  // Sub-phases of Planner Total (indented underneath)
  const subPhases = [
    { label: 'Analyzer', value: planner.analyzer },
    { label: 'Transformer', value: planner.transformer },
    { label: 'Optimizer', value: planner.optimizer },
    { label: 'ExecPlanBuild', value: planner.execPlanBuild },
  ].filter(p => p.value > 0).sort((a, b) => b.value - a.value);

  const renderRow = (phase, indent) => {
    const pct = grandTotal > 0 ? (phase.value / grandTotal) * 100 : 0;
    const cls = indent ? 'planner-phase-row indent' : 'planner-phase-row';
    return `
      <div class="${cls}">
        <span class="planner-phase-label">${phase.label}</span>
        <div class="planner-phase-bar-wrapper">
          <div class="planner-phase-bar" style="width: ${Math.max(pct, 0.5)}%"></div>
        </div>
        <span class="planner-phase-time">${formatTime(phase.value)}</span>
      </div>
    `;
  };

  // Total row at the top
  let rows = `
    <div class="planner-phase-row total">
      <span class="planner-phase-label">Total</span>
      <div class="planner-phase-bar-wrapper">
        <div class="planner-phase-bar" style="width: 100%"></div>
      </div>
      <span class="planner-phase-time">${formatTime(grandTotal)}</span>
    </div>
  `;

  for (const phase of topPhases) {
    rows += renderRow(phase, false);
    // Insert indented sub-phases right after Planner Total
    if (phase.label === 'Planner Total' && subPhases.length > 0) {
      rows += subPhases.map(p => renderRow(p, true)).join('');
    }
  }

  return `
    <div class="planner-breakdown-toggle">
      <span class="planner-toggle-icon">▶</span> Planner Phases
    </div>
    <div class="planner-breakdown-wrapper">
      ${rows}
    </div>
  `;
}

/**
 * Render Pipeline Timeline section
 */
function renderPipelineTimeline(analysis) {
  const container = document.getElementById('timelineContainer');

  if (analysis.fragments.length === 0) {
    container.innerHTML = '<p class="no-data">No pipeline data available</p>';
    return;
  }

  // Collect all pipelines and find max driver time
  let maxDriverTime = 0;
  const allPipelines = [];
  analysis.fragments.forEach(fragment => {
    fragment.pipelines.forEach(pipeline => {
      allPipelines.push(pipeline);
      if (pipeline.driverTotalTime > maxDriverTime) {
        maxDriverTime = pipeline.driverTotalTime;
      }
    });
  });

  // Rank pipelines by active time (descending)
  const pipelineRanks = new Map();
  const sortedByActive = [...allPipelines].sort((a, b) => b.activeTime - a.activeTime);
  sortedByActive.forEach((pipeline, index) => {
    // Create unique key for pipeline (fragmentId + pipelineId)
    const key = `${pipeline.fragmentId}-${pipeline.id}`;
    pipelineRanks.set(key, index + 1); // 1-indexed rank
  });

  const timelineHtml = analysis.fragments.map(fragment => {
    if (fragment.pipelines.length === 0) return '';

    // Sort pipelines by ID
    const sortedPipelines = [...fragment.pipelines].sort((a, b) => a.id - b.id);

    const pipelinesHtml = sortedPipelines.map(pipeline => {
      const totalTime = pipeline.driverTotalTime || 0;

      // Bar width relative to the max pipeline (longest pipeline = 100%)
      const barWidthPct = maxDriverTime > 0 ? (totalTime / maxDriverTime) * 100 : 0;

      // Segment widths as percentage of THIS pipeline's total time
      const activePct = totalTime > 0 ? (pipeline.activeTime / totalTime) * 100 : 0;
      const schedulePct = totalTime > 0 ? (pipeline.scheduleTime / totalTime) * 100 : 0;
      const waitingPct = Math.max(0, 100 - activePct - schedulePct);

      // Format times for display and tooltips
      const activeTimeStr = formatTime(pipeline.activeTime);
      const scheduleTimeStr = formatTime(pipeline.scheduleTime);
      const waitingTimeStr = formatTime(pipeline.inputEmptyTime);
      const totalTimeStr = formatTime(pipeline.driverTotalTime);

      // Determine rank class for highlighting
      const pipelineKey = `${fragment.id}-${pipeline.id}`;
      const rank = pipelineRanks.get(pipelineKey);
      let rankClass = '';
      if (rank === 1) {
        rankClass = 'rank-top1';
      } else if (rank >= 2 && rank <= 5) {
        rankClass = 'rank-top5';
      }

      // Generate operator rows (collapsed by default)
      const maxOpTime = pipeline.operators.length > 0
        ? pipeline.operators[0].operatorTime  // Already sorted desc
        : 0;

      const operatorsHtml = pipeline.operators.length > 0 ? `
        <div class="pipeline-operators">
          ${pipeline.operators.map((op, idx) => {
            const barPct = maxOpTime > 0 ? (op.operatorTime / maxOpTime) * 100 : 0;
            const searchName = op.name.replace(/"/g, '&quot;');
            return `
            <div class="operator-row${idx === 0 ? ' top-operator' : ''}" onclick="window.searchOperatorInRaw('${searchName}')" title="Click to find in Raw JSON">
              <div class="operator-name">${op.name}</div>
              <div class="operator-time-bar"><div class="operator-time-bar-fill" style="width: ${barPct}%"></div></div>
              <div class="operator-time">${op.operatorTimeStr}</div>
            </div>
          `}).join('')}
        </div>
      ` : '';

      const hasOperators = pipeline.operators.length > 0;

      return `
        <div class="timeline-row-container collapsed">
          <div class="timeline-row ${rankClass}${hasOperators ? ' expandable' : ''}"${hasOperators ? ' onclick="this.parentElement.classList.toggle(\'collapsed\')"' : ''}>
            <div class="timeline-label" title="Pipeline ${pipeline.id}">${hasOperators ? '<span class="pipeline-toggle-icon">▶</span>' : ''}Pipeline ${pipeline.id}</div>
            <div class="timeline-bar-wrapper">
              <div class="timeline-bar" style="width: ${Math.max(barWidthPct, 0.5)}%" data-tooltip="Total: ${totalTimeStr}">
                <div class="timeline-segment active" style="width: ${activePct}%" data-tooltip="Active: ${activeTimeStr} (${activePct.toFixed(1)}%)"></div>
                <div class="timeline-segment schedule" style="width: ${schedulePct}%" data-tooltip="Schedule: ${scheduleTimeStr} (${schedulePct.toFixed(1)}%)"></div>
                <div class="timeline-segment waiting" style="width: ${waitingPct}%" data-tooltip="Waiting: ${waitingTimeStr} (${waitingPct.toFixed(1)}%)"></div>
              </div>
            </div>
            <div class="timeline-time">${rank <= 5 ? `<span class="rank-badge">#${rank}</span> ` : ''}Active: ${activeTimeStr}</div>
          </div>
          ${operatorsHtml}
        </div>
      `;
    }).join('');

    // All fragments are collapsible, default expanded
    return `
      <div class="timeline-fragment">
        <div class="timeline-fragment-header timeline-fragment-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
          <span class="toggle-icon">▼</span>
          Fragment ${fragment.id} <span class="section-subtitle">(${sortedPipelines.length} pipeline${sortedPipelines.length !== 1 ? 's' : ''})</span>
        </div>
        <div class="timeline-pipelines">
          ${pipelinesHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = timelineHtml;
}

/**
 * Render Quick Stats section
 */
function renderQuickStats(analysis) {
  const container = document.getElementById('quickStatsGrid');
  const stats = analysis.executionStats;

  const statCards = [
    { label: 'Wall Time', value: formatTime(analysis.queryWallTime), type: 'time' },
    { label: 'Active Time', value: formatTime(analysis.totalActiveTime), type: 'time', tooltip: 'Total CPU work time (excludes waiting)' },
    { label: 'Operator Time', value: stats.operatorTime, type: 'time' },
    { label: 'Scan Time', value: stats.scanTime, type: 'time' },
    { label: 'Network Time', value: stats.networkTime, type: 'time' },
    { label: 'CPU Time', value: stats.cpuTime, type: 'time' },
    { label: 'Allocated Memory', value: stats.allocatedMemory, type: 'bytes' },
    { label: 'Peak Memory/Node', value: stats.peakMemory, type: 'bytes' },
    { label: 'Spill Bytes', value: stats.spillBytes, type: stats.spillBytes !== '0 B' && stats.spillBytes !== '0.000 B' ? 'danger' : 'bytes' },
  ];

  container.innerHTML = statCards.map(stat => `
    <div class="stat-card"${stat.tooltip ? ` data-tooltip="${stat.tooltip}"` : ''}>
      <div class="stat-label">${stat.label}</div>
      <div class="stat-value ${stat.type}">${stat.value}</div>
    </div>
  `).join('');
}

/**
 * Clear the Overview dashboard
 */
export function clearOverview() {
  const dropZone = document.getElementById('overviewDropZone');
  const dashboard = document.getElementById('overviewDashboard');

  if (dropZone) dropZone.classList.remove('hidden');
  if (dashboard) dashboard.classList.remove('visible');

  // Clear all content
  const containers = ['overviewQueryMeta', 'planningBarContainer', 'timelineContainer', 'quickStatsGrid'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  // Hide planning bar
  const planningBar = document.getElementById('planningBarContainer');
  if (planningBar) planningBar.style.display = 'none';
}
