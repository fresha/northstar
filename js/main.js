/**
 * NorthStar - Query Analyzer for StarRocks
 * Main entry point
 */

import { processQueryProfile } from './scanParser.js';
import { renderDashboard } from './scanRender.js';
import { initCompare } from './compare.js';
import { setupPlanDropZone } from './visualizer.js';
import { processJoinProfile } from './joinParser.js';
import { renderJoinDashboard } from './joinRender.js';
import { trackEvent } from './analytics.js';
import { initQueryState, getQuery, setQuery, addListener, hasQuery, getShareableUrl } from './queryState.js';

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
// DOM Elements - Raw JSON Tab
// ========================================
const rawJsonContent = document.getElementById('rawJsonContent');
const btnCopyRaw = document.getElementById('btnCopyRaw');

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
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Show the selected tab panel
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Track tab switch
    trackEvent(`tab-${tabId}`);
  });
});

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

// Set up global load button
globalLoadBtn.addEventListener('click', () => {
  globalFileInput.click();
});

// Handle global file selection
globalFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    loadGlobalFile(file);
  }
});

// Set up global share button
globalShareBtn.addEventListener('click', () => {
  const url = getShareableUrl();
  console.log('Share URL:', url);
  console.log('URL length:', url.length);

  navigator.clipboard.writeText(url).then(() => {
    // Visual feedback
    const originalText = globalShareBtn.textContent;
    globalShareBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      globalShareBtn.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy URL:', err);
    alert('Failed to copy URL to clipboard');
  });
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

// Update the Raw JSON tab with formatted JSON
function updateRawTab(json) {
  const formatted = JSON.stringify(json, null, 2);
  rawJsonContent.innerHTML = `<code>${escapeHtml(formatted)}</code>`;
}

// Escape HTML to prevent XSS (though we control the content)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  rawJsonContent.innerHTML = '<code>No query loaded. Use the "Load Query" button above to load a query profile.</code>';

  // Plan tab cleared via its own listener in visualizer.js
}

// Copy raw JSON to clipboard
btnCopyRaw.addEventListener('click', () => {
  const query = getQuery();
  if (!query) {
    alert('No query loaded to copy');
    return;
  }

  const jsonString = JSON.stringify(query, null, 2);
  navigator.clipboard.writeText(jsonString).then(() => {
    // Visual feedback
    const originalText = btnCopyRaw.textContent;
    btnCopyRaw.textContent = '✓ Copied!';
    setTimeout(() => {
      btnCopyRaw.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy JSON:', err);
    alert('Failed to copy JSON to clipboard');
  });
});

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

// Initialize comparison functionality (stays independent)
initCompare();

// Initialize plan visualization (sets up listener for global state)
setupPlanDropZone();

// Initialize query state from URL or localStorage
// This MUST be called AFTER all listeners are set up so they receive the initial state
initQueryState();

