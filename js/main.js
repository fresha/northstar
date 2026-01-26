/**
 * NorthStar - Query Analyzer for StarRocks
 * Main entry point
 */

import { processQueryProfile } from './scanParser.js';
import { renderDashboard } from './scanRender.js';
import { initCompare, hasCompareData, getCompareRawJson, getCompareSource, setCompareSource, loadCompareFromJson, setBaselineFromQuery, clearCompare } from './compare.js';
import { setupPlanDropZone, refreshPlanView, zoomToNode } from './visualizer.js';
import { processJoinProfile } from './joinParser.js';
import { renderJoinDashboard } from './joinRender.js';
import { trackEvent } from './analytics.js';
import { initQueryState, getQuery, setQuery, clearQuery, addListener, hasQuery, getShareableUrl, getQuerySource } from './queryState.js';
import { loadFromUrl, shareToDpaste, parseNorthStarUrl, extractGistId, extractPasteId, buildQueryUrl, buildCompareUrl } from './urlLoader.js';
import { initRawJson, updateRawTab, clearRawTab, searchFor } from './rawJson.js';
import { initTheme } from './theme.js';

// ========================================
// DOM Elements - Scan Summary Tab
// ========================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const dashboard = document.getElementById('dashboard');

// ========================================
// DOM Elements - Join Summary Tab
// ========================================
const joinDropZone = document.getElementById('joinDropZone');
const joinFileInput = document.getElementById('joinFileInput');
const joinDashboard = document.getElementById('joinDashboard');

// ========================================
// File Loading - Drag and Drop
// ========================================

// When user drags a file over the drop zone
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault(); // Prevent browser from opening the file
  dropZone.classList.add('drag-over'); // Add visual feedback
});

// When user's drag leaves the drop zone
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

// When user drops a file
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  
  // Get the dropped file (we only care about the first one)
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.json')) {
    loadFile(file);
  } else {
    alert('Please drop a JSON file');
  }
});

// Click on drop zone opens Load Query modal
dropZone.addEventListener('click', () => {
  showLoadModal();
});

// When user selects a file via the file picker
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    loadFile(file);
  }
});

// ========================================
// File Loading Function
// ========================================
function loadFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      // Parse the JSON content
      const json = JSON.parse(e.target.result);

      // Validate it's a query profile
      if (!json.Query) {
        alert('Invalid query profile format - missing "Query" field');
        return;
      }

      // Update global state (will trigger all tabs to update)
      setQuery(json);

      // Track successful upload
      trackEvent('upload-scan');

    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON file: ' + error.message);
    }
  };

  reader.readAsText(file);
}

// ========================================
// Tab Navigation
// ========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    switchToTab(btn.dataset.tab);
  });
});

/**
 * Get the current active tab ID
 */
function getCurrentTab() {
  const activeBtn = document.querySelector('.tab-btn.active');
  return activeBtn ? activeBtn.dataset.tab : 'scan';
}

/**
 * Update share button visibility based on current context
 * Shows button if: on compare tab with data, or on other tabs with query loaded
 */
function updateShareButtonVisibility() {
  const currentTab = getCurrentTab();

  if (currentTab === 'compare') {
    // On compare tab, show button if comparison data is loaded
    globalShareBtn.style.display = hasCompareData() ? 'block' : 'none';
  } else {
    // On other tabs, show button if query is loaded
    globalShareBtn.style.display = hasQuery() ? 'block' : 'none';
  }
}

/**
 * Switch to a specific tab by ID
 * Valid tabs: scan, join, plan, raw, compare
 */
function switchToTab(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (!btn) return;

  // Update button states
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Show the selected tab panel
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Refresh plan view when switching to Plan tab (fixes layout calculated while hidden)
  if (tabId === 'plan') {
    refreshPlanView();
  }

  // Update share button visibility based on tab context
  updateShareButtonVisibility();

  // Track tab switch
  trackEvent(`tab-${tabId}`);
}

// ========================================
// Join Summary Tab - File Loading
// ========================================

// When user drags a file over the join drop zone
joinDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  joinDropZone.classList.add('drag-over');
});

// When user's drag leaves the join drop zone
joinDropZone.addEventListener('dragleave', () => {
  joinDropZone.classList.remove('drag-over');
});

// When user drops a file on join drop zone
joinDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  joinDropZone.classList.remove('drag-over');

  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.json')) {
    loadJoinFile(file);
  } else {
    alert('Please drop a JSON file');
  }
});

// Click on join drop zone opens Load Query modal
joinDropZone.addEventListener('click', () => {
  showLoadModal();
});

// When user selects a file via the join file picker
joinFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    loadJoinFile(file);
  }
});

// ========================================
// Join File Loading Function
// ========================================
function loadJoinFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      // Parse the JSON content
      const json = JSON.parse(e.target.result);

      // Validate it's a query profile
      if (!json.Query) {
        alert('Invalid query profile format - missing "Query" field');
        return;
      }

      // Update global state (will trigger all tabs to update)
      setQuery(json);

      // Track successful upload
      trackEvent('upload-join');

    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON file: ' + error.message);
    }
  };

  reader.readAsText(file);
}

// ========================================
// Global Query State Management
// ========================================

const globalLoadBtn = document.getElementById('globalLoadBtn');
const globalShareBtn = document.getElementById('globalShareBtn');
const globalFileInput = document.getElementById('globalFileInput');

// Modal elements - Load Query
const loadModal = document.getElementById('loadModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeModal = document.getElementById('closeModal');
const loadFromFile = document.getElementById('loadFromFile');
const loadFromUrlBtn = document.getElementById('loadFromUrl');
const urlInputContainer = document.getElementById('urlInputContainer');
const urlInput = document.getElementById('urlInput');
const btnLoadUrl = document.getElementById('btnLoadUrl');
const btnCancelUrl = document.getElementById('btnCancelUrl');

// Modal elements - Share Query
const shareModal = document.getElementById('shareModal');
const closeShareModal = document.getElementById('closeShareModal');
const btnCancelShare = document.getElementById('btnCancelShare');
const btnConfirmShare = document.getElementById('btnConfirmShare');

// Set up global load button - opens modal
globalLoadBtn.addEventListener('click', showLoadModal);

// Set up logo link - clears state and goes to home
document.getElementById('logoLink').addEventListener('click', (e) => {
  e.preventDefault();
  clearQuery();
  // Navigate to clean URL (removes query params)
  window.history.replaceState(null, '', window.location.pathname);
  // Switch to default tab
  switchToTab('scan');
});

// Expose showLoadModal globally for other modules
window.showLoadModal = showLoadModal;

// Show the Load Query modal
function showLoadModal() {
  loadModal.style.display = 'block';
  modalBackdrop.style.display = 'block';
}

// Close modal and reset to initial state
function closeLoadModal() {
  loadModal.style.display = 'none';
  modalBackdrop.style.display = 'none';
  urlInputContainer.style.display = 'none';
  urlInput.value = '';
  // Reset to show load options
  document.querySelector('.load-options').style.display = 'grid';
}

// Close any open modal
function closeAnyOpenModal() {
  if (loadModal.style.display === 'block') {
    closeLoadModal();
  }
  if (shareModal.style.display === 'block') {
    closeShareModalFn();
  }
}

closeModal.addEventListener('click', closeLoadModal);
modalBackdrop.addEventListener('click', closeAnyOpenModal);

// Close modals with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAnyOpenModal();
  }
});

// Load from file option
loadFromFile.addEventListener('click', () => {
  closeLoadModal();
  globalFileInput.click();
});

// Load from URL option
loadFromUrlBtn.addEventListener('click', () => {
  document.querySelector('.load-options').style.display = 'none';
  urlInputContainer.style.display = 'block';
  urlInput.focus();
});

// Cancel URL input
btnCancelUrl.addEventListener('click', () => {
  document.querySelector('.load-options').style.display = 'grid';
  urlInputContainer.style.display = 'none';
  urlInput.value = '';
});

// Load URL button
btnLoadUrl.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  try {
    btnLoadUrl.textContent = 'Loading...';
    btnLoadUrl.disabled = true;

    const query = await loadFromUrl(url);

    if (!query.Query) {
      throw new Error('Invalid query profile format');
    }

    // Determine source type and ID
    let source = null;
    const gistId = extractGistId(url);
    const pasteId = extractPasteId(url);

    if (gistId) {
      source = { type: 'gist', id: gistId, url };
    } else if (pasteId) {
      source = { type: 'paste', id: pasteId, url };
    }

    setQuery(query, source);
    trackEvent('upload-url');
    closeLoadModal();

  } catch (error) {
    console.error('Error loading from URL:', error);
    alert(`Failed to load query: ${error.message}`);
  } finally {
    btnLoadUrl.textContent = 'Load';
    btnLoadUrl.disabled = false;
  }
});

// Handle global file selection
globalFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    loadGlobalFile(file);
  }
});

// Set up global share button - reuses source or creates dpaste
globalShareBtn.addEventListener('click', async () => {
  const currentTab = getCurrentTab();
  const originalText = globalShareBtn.textContent;

  // Handle comparison tab sharing
  if (currentTab === 'compare') {
    if (!hasCompareData()) {
      alert('Load both baseline and optimized profiles to share a comparison');
      return;
    }

    const compareSource = getCompareSource();

    // If comparison was loaded from URL, reuse those IDs
    if (compareSource && compareSource.baseline && compareSource.optimized) {
      const shareUrl = `${buildCompareUrl(compareSource.baseline, compareSource.optimized)}#compare`;

      try {
        await navigator.clipboard.writeText(shareUrl);
        globalShareBtn.textContent = '✓ Link copied!';
        setTimeout(() => {
          globalShareBtn.textContent = originalText;
        }, 2000);
        trackEvent('share-compare-reuse');
      } catch (error) {
        console.error('Failed to copy URL:', error);
        alert('Failed to copy URL to clipboard');
      }
      return;
    }

    // Show confirmation modal for creating new dpaste
    shareModal.style.display = 'block';
    modalBackdrop.style.display = 'block';
    return;
  }

  // Handle regular query sharing
  const query = getQuery();
  if (!query) {
    alert('No query loaded to share');
    return;
  }

  const source = getQuerySource();

  // If query was loaded from gist/paste, reuse that URL
  if (source && (source.type === 'gist' || source.type === 'paste')) {
    const shareUrl = `${buildQueryUrl(source)}#${currentTab}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      globalShareBtn.textContent = '✓ Link copied!';
      setTimeout(() => {
        globalShareBtn.textContent = originalText;
      }, 2000);
      trackEvent('share-reuse');
    } catch (error) {
      console.error('Failed to copy URL:', error);
      alert('Failed to copy URL to clipboard');
    }
    return;
  }

  // Otherwise, show confirmation modal and create new dpaste
  shareModal.style.display = 'block';
  modalBackdrop.style.display = 'block';
});

// Close share modal handlers
function closeShareModalFn() {
  shareModal.style.display = 'none';
  modalBackdrop.style.display = 'none';
}

closeShareModal.addEventListener('click', closeShareModalFn);
btnCancelShare.addEventListener('click', closeShareModalFn);

// Confirm share - create dpaste (handles both single query and comparison)
btnConfirmShare.addEventListener('click', async () => {
  const currentTab = getCurrentTab();
  const originalText = globalShareBtn.textContent;

  try {
    btnConfirmShare.textContent = 'Creating...';
    btnConfirmShare.disabled = true;
    globalShareBtn.textContent = '⏳ Creating share link...';
    globalShareBtn.disabled = true;

    let shareUrl;

    // Handle comparison sharing
    if (currentTab === 'compare' && hasCompareData()) {
      const rawJson = getCompareRawJson();

      // Create both pastes in parallel
      const [baselinePasteUrl, optimizedPasteUrl] = await Promise.all([
        shareToDpaste(rawJson.baseline),
        shareToDpaste(rawJson.optimized)
      ]);

      // Extract paste IDs
      const baselineId = baselinePasteUrl.replace('https://dpaste.com/', '').replace('.txt', '');
      const optimizedId = optimizedPasteUrl.replace('https://dpaste.com/', '').replace('.txt', '');

      // Store source for potential reuse
      const baselineSource = { type: 'paste', id: baselineId };
      const optimisedSource = { type: 'paste', id: optimizedId };
      setCompareSource({
        baseline: baselineSource,
        optimized: optimisedSource
      });

      // Generate comparison URL using new query param format
      shareUrl = buildCompareUrl(baselineSource, optimisedSource);

      trackEvent('share-compare-dpaste');
    } else {
      // Handle single query sharing
      const query = getQuery();

      // Create paste on dpaste.com
      const pasteUrl = await shareToDpaste(query);

      // Extract paste ID from URL
      const pasteId = pasteUrl.replace('https://dpaste.com/', '').replace('.txt', '');

      // Generate NorthStar URL with current tab using new query param format
      const source = { type: 'paste', id: pasteId };
      shareUrl = `${buildQueryUrl(source)}#${currentTab}`;

      trackEvent('share-dpaste');
    }

    // Copy to clipboard
    await navigator.clipboard.writeText(shareUrl);

    globalShareBtn.textContent = '✓ Link copied!';
    closeShareModalFn();

    setTimeout(() => {
      globalShareBtn.textContent = originalText;
      globalShareBtn.disabled = false;
    }, 2000);

  } catch (error) {
    console.error('Failed to create share link:', error);
    alert(`Failed to create share link: ${error.message}`);
    globalShareBtn.textContent = originalText;
    globalShareBtn.disabled = false;
  } finally {
    btnConfirmShare.textContent = 'Create Share Link';
    btnConfirmShare.disabled = false;
  }
});

// Load file into global state
function loadGlobalFile(file) {
  const reader = new FileReader();

  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);

      // Validate it's a query profile
      if (!json.Query) {
        alert('Invalid query profile format - missing "Query" field');
        return;
      }

      // Set in global state (will trigger all listeners)
      setQuery(json);

      // Track upload
      trackEvent('upload-global');

    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON file: ' + error.message);
    }
  };

  reader.readAsText(file);
}

// Listen for query state changes to update UI
addListener((query) => {
  if (query) {
    // Update all tabs with the new query
    updateAllTabsWithQuery(query);
  } else {
    // Clear all tabs
    clearAllTabs();
  }

  // Update share button visibility based on current context
  updateShareButtonVisibility();
});

// Update all tabs when query changes
function updateAllTabsWithQuery(json) {
  // Update Scan Summary tab
  try {
    const { summary, execution, connectorScans } = processQueryProfile(json);
    renderDashboard(summary, execution, connectorScans, dropZone, dashboard);
  } catch (error) {
    console.error('Error updating Scan Summary tab:', error);
  }

  // Update Join Summary tab
  try {
    const { summary, execution, joins } = processJoinProfile(json);
    renderJoinDashboard(summary, execution, joins, joinDropZone, joinDashboard);
  } catch (error) {
    console.error('Error updating Join Summary tab:', error);
  }

  // Update Raw JSON tab
  try {
    updateRawTab(json);
  } catch (error) {
    console.error('Error updating Raw JSON tab:', error);
  }

  // Update Compare tab - set as baseline, clear optimized
  try {
    const source = getQuerySource();
    setBaselineFromQuery(json, source);
  } catch (error) {
    console.error('Error updating Compare tab:', error);
  }

  // Note: Plan tab updated via its own listener in visualizer.js
}

// Clear all tabs
function clearAllTabs() {
  // Reset Scan Summary - use classList to match how renderDashboard hides it
  dropZone.classList.remove('hidden');
  dashboard.classList.remove('visible');

  // Reset Join Summary - use classList to match how renderJoinDashboard hides it
  joinDropZone.classList.remove('hidden');
  joinDashboard.classList.remove('visible');

  // Reset Raw JSON tab
  clearRawTab();

  // Reset Compare tab
  clearCompare();

  // Plan tab cleared via its own listener in visualizer.js
}

// ========================================
// Initialize
// ========================================

// Initialize theme (dark/light mode) - do this first to prevent flash
initTheme();

// Initialize comparison functionality (stays independent)
initCompare();

// Initialize Raw JSON tab (search, copy)
initRawJson();

// Initialize plan visualization (sets up listener for global state)
setupPlanDropZone();

/// Initialize query state from URL (#gist:ID, #paste:ID, or #compare:ID1..ID2)
// This MUST be called AFTER all listeners are set up so they receive the initial state
// It's async now because it loads from external URLs
initQueryState().then(({ loaded, tab, isCompare, compareData }) => {
  // Handle comparison URL
  if (isCompare && compareData) {
    loadCompareFromJson(
      compareData.baselineJson,
      compareData.optimizedJson,
      compareData.source
    );
    trackEvent('load-compare-url');
  }

  // Switch to the tab specified in URL (if any)
  if (loaded && tab) {
    switchToTab(tab);
  }
}).catch(err => {
  console.error('Failed to initialize query state:', err);
  alert(`Failed to load shared link: ${err.message}`);
});

// ========================================
// Global Navigation Functions
// Exposed for use by other modules (e.g., scanRender.js popup, compare.js)
// ========================================

/**
 * Update share button visibility (called when comparison data changes)
 */
window.updateShareButtonVisibility = updateShareButtonVisibility;

/**
 * Navigate to a specific node in the Query Plan tab
 * @param {number} planNodeId - The plan_node_id to navigate to
 */
window.navigateToQueryPlanNode = function(planNodeId) {
  switchToTab('plan');
  // Give time for the tab to render before zooming
  setTimeout(() => {
    zoomToNode(planNodeId);
  }, 100);
};

/**
 * Navigate to Raw JSON tab and search for an operator by type
 * @param {number} planNodeId - The plan_node_id to search for
 * @param {string} operatorType - The operator type ('scan' or 'join')
 */
window.navigateToRawJsonNode = function(planNodeId, operatorType = 'scan') {
  switchToTab('raw');
  // Give time for the tab to become visible
  setTimeout(() => {
    const searchTerm = operatorType === 'join'
      ? `HASH_JOIN_PROBE (plan_node_id=${planNodeId})`
      : `CONNECTOR_SCAN (plan_node_id=${planNodeId})`;
    searchFor(searchTerm);
  }, 100);
};

