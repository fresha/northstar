/**
 * NorthStar - Query Analyzer for StarRocks
 * Main entry point
 */

import { processQueryProfile } from './scanParser.js';
import { renderDashboard } from './scanRender.js';
import { initCompare } from './compare.js';
import { setupPlanDropZone, refreshPlanView, zoomToNode } from './visualizer.js';
import { processJoinProfile } from './joinParser.js';
import { renderJoinDashboard } from './joinRender.js';
import { trackEvent } from './analytics.js';
import { initQueryState, getQuery, setQuery, addListener, hasQuery, getShareableUrl, getQuerySource } from './queryState.js';
import { loadFromUrl, shareToDpaste, parseNorthStarUrl, extractGistId, extractPasteId } from './urlLoader.js';
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

// Click on drop zone opens file picker
dropZone.addEventListener('click', () => {
  fileInput.click();
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

// Click on join drop zone opens file picker
joinDropZone.addEventListener('click', () => {
  joinFileInput.click();
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
globalLoadBtn.addEventListener('click', () => {
  loadModal.style.display = 'block';
  modalBackdrop.style.display = 'block';
});

// Close modal and reset to initial state
function closeLoadModal() {
  loadModal.style.display = 'none';
  modalBackdrop.style.display = 'none';
  urlInputContainer.style.display = 'none';
  urlInput.value = '';
  // Reset to show load options
  document.querySelector('.load-options').style.display = 'grid';
}

closeModal.addEventListener('click', closeLoadModal);
modalBackdrop.addEventListener('click', () => {
  // Close whichever modal is open
  if (loadModal.style.display === 'block') {
    closeLoadModal();
  }
  if (shareModal.style.display === 'block') {
    closeShareModalFn();
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
  const query = getQuery();
  if (!query) {
    alert('No query loaded to share');
    return;
  }

  const source = getQuerySource();
  const originalText = globalShareBtn.textContent;

  // If query was loaded from gist/paste, reuse that URL
  if (source && (source.type === 'gist' || source.type === 'paste')) {
    const currentTab = getCurrentTab();
    const shareUrl = `${window.location.origin}${window.location.pathname}#${source.type}:${source.id}&tab=${currentTab}`;

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

// Confirm share - create dpaste
btnConfirmShare.addEventListener('click', async () => {
  const query = getQuery();
  const originalText = globalShareBtn.textContent;

  try {
    btnConfirmShare.textContent = 'Creating...';
    btnConfirmShare.disabled = true;
    globalShareBtn.textContent = '⏳ Creating share link...';
    globalShareBtn.disabled = true;

    // Create paste on dpaste.com
    const pasteUrl = await shareToDpaste(query);

    // Extract paste ID from URL
    const pasteId = pasteUrl.replace('https://dpaste.com/', '').replace('.txt', '');

    // Generate NorthStar URL with current tab
    const currentTab = getCurrentTab();
    const shareUrl = `${window.location.origin}${window.location.pathname}#paste:${pasteId}&tab=${currentTab}`;

    // Copy to clipboard
    await navigator.clipboard.writeText(shareUrl);

    globalShareBtn.textContent = '✓ Link copied!';
    closeShareModalFn();

    setTimeout(() => {
      globalShareBtn.textContent = originalText;
      globalShareBtn.disabled = false;
    }, 2000);

    trackEvent('share-dpaste');

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
    // Show share button when query is loaded
    globalShareBtn.style.display = 'block';

    // Update all tabs with the new query
    updateAllTabsWithQuery(query);
  } else {
    // Hide share button when no query
    globalShareBtn.style.display = 'none';

    // Clear all tabs
    clearAllTabs();
  }
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

  // Note: Compare tab remains independent (needs two queries)
  // Note: Plan tab updated via its own listener in visualizer.js
}

// Clear all tabs
function clearAllTabs() {
  // Reset Scan Summary
  dropZone.style.display = 'block';
  dashboard.classList.remove('visible');

  // Reset Join Summary
  joinDropZone.style.display = 'block';
  joinDashboard.classList.remove('visible');

  // Reset Raw JSON tab
  clearRawTab();

  // Plan tab cleared via its own listener in visualizer.js
}

// ========================================
// Reset Buttons - Load New Profile
// ========================================

// Scan Summary reset button
document.getElementById('scanReset').addEventListener('click', () => {
  dropZone.classList.remove('hidden');
  dashboard.classList.remove('visible');
  fileInput.value = ''; // Clear file input so same file can be re-selected
});

// Join Summary reset button
document.getElementById('joinReset').addEventListener('click', () => {
  joinDropZone.classList.remove('hidden');
  joinDashboard.classList.remove('visible');
  joinFileInput.value = ''; // Clear file input so same file can be re-selected
});

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

/// Initialize query state from URL (#gist:ID or #paste:ID)
// This MUST be called AFTER all listeners are set up so they receive the initial state
// It's async now because it loads from external URLs
initQueryState().then(({ loaded, tab }) => {
  // Switch to the tab specified in URL (if any)
  if (loaded && tab) {
    switchToTab(tab);
  }
}).catch(err => {
  console.error('Failed to initialize query state:', err);
});

// ========================================
// Global Navigation Functions
// Exposed for use by other modules (e.g., scanRender.js popup)
// ========================================

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

