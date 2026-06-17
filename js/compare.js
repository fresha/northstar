/**
 * Query comparison functionality
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes, formatTime } from './utils.js';
import { findConnectorScans } from './scanParser.js';
import { findHashJoins, combineJoinOperators, calculateJoinStats, sumOperatorTimesByPlanNodeId, extractJoinMetrics } from './joinParser.js';
import { trackEvent } from './analytics.js';
import { loadFromUrl, extractPasteId } from './urlLoader.js';
import { extractFragments, analyzeFragments, extractPlannerTiming } from './overviewParser.js';
import { renderComparison, initCompareUI } from './compareRender.js';

// Compare type labels configuration
const COMPARE_LABELS = {
  baseline: { title: '📊 Baseline', fullTitle: '📊 Baseline Query', description: 'original' },
  optimized: { title: '🚀 Optimized', fullTitle: '🚀 Optimized Query', description: 'optimized' }
};

// Store loaded comparison data
let compareData = {
  baseline: null,
  optimized: null
};

// Store raw JSON for sharing
let compareRawJson = {
  baseline: null,
  optimized: null
};

// Store source info for comparison (for reusing on share)
let compareSource = null; // { baseline: { type, id }, optimized: { type, id } }

/**
 * Extract comparison data from a query profile JSON
 * @param {Object} json - Query profile JSON
 * @returns {Object} Extracted data { summary, execution, scans, joinMetrics, joinStats }
 */
function extractCompareData(json) {
  const query = json.Query;
  const summary = query.Summary || {};
  const execution = query.Execution || {};
  const scans = findConnectorScans(execution);

  // Extract join data
  const { probes, builds } = findHashJoins(execution);
  const joins = combineJoinOperators(probes, builds);
  const planNodeIds = new Set(joins.map(j => j.planNodeId));
  const totalTimesByPlanNodeId = sumOperatorTimesByPlanNodeId(execution, planNodeIds);

  // Build join metrics with total time
  const joinMetrics = joins.map(join => {
    const totalTime = totalTimesByPlanNodeId.get(join.planNodeId) || 0;
    return extractJoinMetrics(join, totalTime, null);
  });

  const joinStats = calculateJoinStats(joinMetrics);

  // Compute total active time from fragments/pipelines
  const fragments = extractFragments(execution);
  const { totalActiveTime } = analyzeFragments(fragments, execution);

  // Planner phase timing (seconds) for the planning vs execution comparison
  const plannerTiming = extractPlannerTiming(query.Planner || {});

  return { summary, execution, scans, joinMetrics, joinStats, totalActiveTime, plannerTiming };
}

/**
 * Render a loaded drop zone with summary info
 * @param {HTMLElement} dropZone - The drop zone element
 * @param {string} type - 'baseline' or 'optimized'
 * @param {Object} summary - Query summary object
 * @param {string} displayText - Text to show as loaded info (e.g., filename or "Loaded from URL")
 */
function renderLoadedDropZone(dropZone, type, summary, displayText) {
  dropZone.classList.add('loaded');
  dropZone.innerHTML = `
    <h3>${COMPARE_LABELS[type].title}</h3>
    <p class="loaded-info">✓ ${displayText}</p>
    <p>${summary['Query ID'] || 'Unknown'}</p>
    <p>Duration: ${summary['Total'] || 'N/A'}</p>
  `;
}

/**
 * Reset a drop zone to its initial state
 * @param {string} dropZoneId - The drop zone element ID
 * @param {string} type - 'baseline' or 'optimized'
 */
function resetDropZone(dropZoneId, type) {
  const dropZone = document.getElementById(dropZoneId);
  if (!dropZone) return;

  dropZone.classList.remove('loaded');
  dropZone.innerHTML = `
    <h3>${COMPARE_LABELS[type].fullTitle}</h3>
    <p>Drop the ${COMPARE_LABELS[type].description} query profile</p>
    <p class="load-url-link" id="loadUrl${type === 'baseline' ? 'Baseline' : 'Optimized'}">or Load from URL</p>
  `;
  dropZone.onclick = null;
  setupCompareUrlLoading(`loadUrl${type === 'baseline' ? 'Baseline' : 'Optimized'}`, dropZoneId, type);
}

/**
 * Setup comparison drop zones
 */
export function setupCompareDropZone(dropZoneId, fileInputId, type) {
  const dropZone = document.getElementById(dropZoneId);
  const fileInput = document.getElementById(fileInputId);

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      loadCompareFile(file, type, dropZone);
    }
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      loadCompareFile(file, type, dropZone);
    }
  });
}

/**
 * Load a comparison file
 */
function loadCompareFile(file, type, dropZone) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);

      if (!json.Query) {
        alert('Invalid query profile format');
        return;
      }

      // Extract data using helper
      const { summary, execution, scans, joinMetrics, joinStats, totalActiveTime, plannerTiming } = extractCompareData(json);

      compareData[type] = {
        summary,
        execution,
        scans,
        joins: joinMetrics,
        joinStats,
        totalActiveTime,
        plannerTiming,
        filename: file.name
      };

      // Store raw JSON for sharing
      compareRawJson[type] = json;

      // Update drop zone to show loaded state
      renderLoadedDropZone(dropZone, type, summary, file.name);

      // Track successful upload
      trackEvent(`upload-compare-${type}`);

      // Check if both files are loaded
      if (compareData.baseline && compareData.optimized) {
        renderComparison(compareData);
      }

      // Update share button visibility (comparison data now available)
      if (window.updateShareButtonVisibility) {
        window.updateShareButtonVisibility();
      }
    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON: ' + error.message);
    }
  };

  reader.readAsText(file);
}

/**
 * Initialize comparison functionality
 */
export function initCompare() {
  setupCompareDropZone('compareDropBaseline', 'compareFileBaseline', 'baseline');
  setupCompareDropZone('compareDropOptimized', 'compareFileOptimized', 'optimized');
  setupCompareUrlLoading('loadUrlBaseline', 'compareDropBaseline', 'baseline');
  setupCompareUrlLoading('loadUrlOptimized', 'compareDropOptimized', 'optimized');
  initCompareUI();
}

/**
 * Setup URL loading for a compare drop zone
 */
function setupCompareUrlLoading(linkId, dropZoneId, type) {
  const link = document.getElementById(linkId);
  if (!link) return;

  link.addEventListener('click', (e) => {
    e.stopPropagation(); // Don't trigger drop zone file picker
    showUrlInput(dropZoneId, type);
  });
}

/**
 * Show URL input in a drop zone
 */
function showUrlInput(dropZoneId, type) {
  const dropZone = document.getElementById(dropZoneId);
  if (!dropZone) return;

  // Store original content
  const originalContent = dropZone.innerHTML;
  const linkId = `loadUrl${type === 'baseline' ? 'Baseline' : 'Optimized'}`;

  // Replace with URL input
  dropZone.innerHTML = `
    <h3>${COMPARE_LABELS[type].title}</h3>
    <div class="url-input-inline">
      <input type="text" id="compareUrlInput_${type}" placeholder="https://dpaste.com/... or https://gist.github.com/...">
      <div class="url-input-actions">
        <button class="btn-cancel-url" id="cancelUrl_${type}">Cancel</button>
        <button class="btn-load-url" id="loadUrl_${type}">Load</button>
      </div>
    </div>
  `;

  // Prevent click on drop zone from triggering file picker
  dropZone.onclick = (e) => e.stopPropagation();

  // Focus the input
  const input = document.getElementById(`compareUrlInput_${type}`);
  input.focus();

  // Restore drop zone to original state
  const restoreDropZone = () => {
    dropZone.innerHTML = originalContent;
    dropZone.onclick = null;
    setupCompareUrlLoading(linkId, dropZoneId, type);
  };

  // Handle cancel
  document.getElementById(`cancelUrl_${type}`).addEventListener('click', (e) => {
    e.stopPropagation();
    restoreDropZone();
  });

  // Handle load
  document.getElementById(`loadUrl_${type}`).addEventListener('click', async (e) => {
    e.stopPropagation();
    const url = input.value.trim();
    if (!url) {
      alert('Please enter a URL');
      return;
    }
    await loadCompareFromUrl(url, type, dropZone);
  });

  // Handle Enter key
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const url = input.value.trim();
      if (url) {
        await loadCompareFromUrl(url, type, dropZone);
      }
    }
    if (e.key === 'Escape') {
      restoreDropZone();
    }
  });
}

/**
 * Load a comparison profile from URL
 */
async function loadCompareFromUrl(url, type, dropZone) {
  const dropZoneId = type === 'baseline' ? 'compareDropBaseline' : 'compareDropOptimized';

  // Show loading state
  dropZone.innerHTML = `
    <h3>${COMPARE_LABELS[type].title}</h3>
    <p>Loading...</p>
  `;

  try {
    const json = await loadFromUrl(url);

    if (!json.Query) {
      throw new Error('Invalid query profile format');
    }

    // Extract source info for sharing
    const pasteId = extractPasteId(url);
    const sourceInfo = pasteId ? { type: 'paste', id: pasteId } : null;

    // Update compareSource
    if (sourceInfo) {
      if (!compareSource) {
        compareSource = {};
      }
      compareSource[type] = sourceInfo;
    }

    // Extract data using helper
    const { summary, execution, scans, joinMetrics, joinStats, totalActiveTime, plannerTiming } = extractCompareData(json);

    compareData[type] = {
      summary,
      execution,
      scans,
      joins: joinMetrics,
      joinStats,
      totalActiveTime,
      plannerTiming,
      filename: 'From URL'
    };

    // Store raw JSON for sharing
    compareRawJson[type] = json;

    // Update drop zone to show loaded state
    dropZone.onclick = null; // Restore normal click behavior
    renderLoadedDropZone(dropZone, type, summary, 'Loaded from URL');

    // Track successful URL load
    trackEvent(`load-compare-url-${type}`);

    // Check if both files are loaded
    if (compareData.baseline && compareData.optimized) {
      renderComparison(compareData);
    }

    // Update share button visibility
    if (window.updateShareButtonVisibility) {
      window.updateShareButtonVisibility();
    }
  } catch (error) {
    console.error('Error loading from URL:', error);
    alert(`Error loading from URL: ${error.message}`);

    // Restore drop zone
    resetDropZone(dropZoneId, type);
  }
}

/**
 * Check if comparison data is ready (both profiles loaded)
 */
export function hasCompareData() {
  return compareData.baseline !== null && compareData.optimized !== null;
}

/**
 * Get raw JSON for sharing
 */
export function getCompareRawJson() {
  return compareRawJson;
}

/**
 * Get comparison source info
 */
export function getCompareSource() {
  return compareSource;
}

/**
 * Set comparison source info
 */
export function setCompareSource(source) {
  compareSource = source;
}

/**
 * Load comparison from JSON objects (for URL loading)
 * @param {Object} baselineJson - Baseline query profile JSON
 * @param {Object} optimizedJson - Optimized query profile JSON
 * @param {Object} source - Source info { baseline: { type, id }, optimized: { type, id } }
 */
export function loadCompareFromJson(baselineJson, optimizedJson, source) {
  // Process baseline
  processCompareJson(baselineJson, 'baseline', 'Baseline (from URL)');

  // Process optimized
  processCompareJson(optimizedJson, 'optimized', 'Optimized (from URL)');

  // Store source for reuse on share
  compareSource = source;

  // Render comparison if both loaded
  if (compareData.baseline && compareData.optimized) {
    renderComparison(compareData);
  }

  // Update share button visibility
  if (window.updateShareButtonVisibility) {
    window.updateShareButtonVisibility();
  }
}

/**
 * Process a JSON query profile for comparison
 */
function processCompareJson(json, type, displayName) {
  if (!json.Query) {
    console.error(`Invalid query profile format for ${type}`);
    return;
  }

  // Extract data using helper
  const { summary, execution, scans, joinMetrics, joinStats, totalActiveTime, plannerTiming } = extractCompareData(json);

  compareData[type] = {
    summary,
    execution,
    scans,
    joins: joinMetrics,
    joinStats,
    totalActiveTime,
    plannerTiming,
    filename: displayName
  };

  // Store raw JSON for potential re-sharing
  compareRawJson[type] = json;

  // Update drop zone to show loaded state
  const dropZoneId = type === 'baseline' ? 'compareDropBaseline' : 'compareDropOptimized';
  const dropZone = document.getElementById(dropZoneId);
  if (dropZone) {
    renderLoadedDropZone(dropZone, type, summary, displayName);
  }
}

/**
 * Reset the comparison view
 * Called when a new query is loaded to clear optimized and show baseline
 */
export function resetCompare() {
  // Clear optimized data (baseline will be set via loadCompareFromJson or processCompareJson)
  compareData.optimized = null;
  compareRawJson.optimized = null;

  // Clear source for optimized
  if (compareSource) {
    compareSource.optimized = null;
  }

  // Reset optimized drop zone
  resetDropZone('compareDropOptimized', 'optimized');

  // Hide comparison results
  const results = document.getElementById('compareResults');
  if (results) {
    results.classList.remove('visible');
  }

  // Update share button visibility
  if (window.updateShareButtonVisibility) {
    window.updateShareButtonVisibility();
  }
}

/**
 * Clear the entire comparison view (both baseline and optimized)
 * Called when clearing all data (e.g., logo click reset)
 */
export function clearCompare() {
  // Clear all data
  compareData.baseline = null;
  compareData.optimized = null;
  compareRawJson.baseline = null;
  compareRawJson.optimized = null;
  compareSource = null;

  // Reset both drop zones
  resetDropZone('compareDropBaseline', 'baseline');
  resetDropZone('compareDropOptimized', 'optimized');

  // Hide comparison results
  const results = document.getElementById('compareResults');
  if (results) {
    results.classList.remove('visible');
  }

  // Update share button visibility
  if (window.updateShareButtonVisibility) {
    window.updateShareButtonVisibility();
  }
}

/**
 * Set baseline from main query (called when a new query is loaded)
 */
export function setBaselineFromQuery(json, source) {
  // Reset the compare view first
  resetCompare();

  // Process the query as baseline
  processCompareJson(json, 'baseline', 'Baseline Query');

  // Store source
  if (!compareSource) compareSource = {};
  compareSource.baseline = source;

  // Store raw JSON
  compareRawJson.baseline = json;
}

