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
      console.log('Loaded JSON:', json);
      
      // Process the data
      const { summary, execution, connectorScans } = processQueryProfile(json);
      
      // Render the dashboard
      renderDashboard(summary, execution, connectorScans, dropZone, dashboard);
      
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
      console.log('Loaded JSON for Join Analysis:', json);

      // Process the data for join analysis
      const { summary, execution, joins } = processJoinProfile(json);

      // Render the join dashboard
      renderJoinDashboard(summary, execution, joins, joinDropZone, joinDashboard);

    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON file: ' + error.message);
    }
  };

  reader.readAsText(file);
}

// ========================================
// Initialize
// ========================================

// Initialize comparison functionality
initCompare();

// Initialize plan visualization
setupPlanDropZone();

console.log('NorthStar - Query Analyzer for StarRocks loaded!');

