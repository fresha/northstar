/**
 * Raw JSON Tab - Display and search functionality
 */

import { getQuery } from './queryState.js';

// DOM Elements
const rawJsonContent = document.getElementById('rawJsonContent');
const btnCopyRaw = document.getElementById('btnCopyRaw');
const rawSearchInput = document.getElementById('rawSearchInput');
const rawSearchCount = document.getElementById('rawSearchCount');
const rawSearchPrev = document.getElementById('rawSearchPrev');
const rawSearchNext = document.getElementById('rawSearchNext');

// Search state
let rawJsonText = '';
let searchMatches = [];
let currentMatchIndex = -1;
let searchTimeout;

/**
 * Initialize Raw JSON tab event listeners
 */
export function initRawJson() {
  // Copy button
  btnCopyRaw.addEventListener('click', handleCopy);

  // Search input with debounce
  rawSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      performSearch(e.target.value);
    }, 150);
  });

  // Keyboard navigation in search input
  rawSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      rawSearchInput.value = '';
      performSearch('');
      rawSearchInput.blur();
    }
  });

  // Navigation buttons
  rawSearchPrev.addEventListener('click', () => navigateMatch(-1));
  rawSearchNext.addEventListener('click', () => navigateMatch(1));
}

/**
 * Update the Raw JSON tab with formatted JSON
 */
export function updateRawTab(json) {
  const formatted = JSON.stringify(json, null, 2);
  rawJsonText = formatted;
  rawJsonContent.innerHTML = `<code>${escapeHtml(formatted)}</code>`;
  clearSearchState();
}

/**
 * Clear/reset the Raw JSON tab
 */
export function clearRawTab() {
  rawJsonText = '';
  rawJsonContent.innerHTML = '<code>No query loaded. Use the "Load Query" button above to load a query profile.</code>';
  clearSearchState();
}

/**
 * Programmatically search for a term in the Raw JSON
 * @param {string} term - The search term
 */
export function searchFor(term) {
  if (!rawJsonText || !term) return;

  rawSearchInput.value = term;
  performSearch(term);
}

// ========================================
// Private functions
// ========================================

function clearSearchState() {
  rawSearchInput.value = '';
  rawSearchCount.textContent = '';
  searchMatches = [];
  currentMatchIndex = -1;
}

function handleCopy() {
  const query = getQuery();
  if (!query) {
    alert('No query loaded to copy');
    return;
  }

  const jsonString = JSON.stringify(query, null, 2);
  navigator.clipboard.writeText(jsonString).then(() => {
    const originalText = btnCopyRaw.textContent;
    btnCopyRaw.textContent = '✓ Copied!';
    setTimeout(() => {
      btnCopyRaw.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy JSON:', err);
    alert('Failed to copy JSON to clipboard');
  });
}

function performSearch(query) {
  if (!rawJsonText || !query) {
    rawJsonContent.innerHTML = `<code>${escapeHtml(rawJsonText || '')}</code>`;
    rawSearchCount.textContent = '';
    searchMatches = [];
    currentMatchIndex = -1;
    return;
  }

  // Find all matches (case-insensitive)
  const regex = new RegExp(escapeRegex(query), 'gi');
  searchMatches = [];
  let match;
  while ((match = regex.exec(rawJsonText)) !== null) {
    searchMatches.push({ start: match.index, end: match.index + match[0].length });
  }

  if (searchMatches.length === 0) {
    rawJsonContent.innerHTML = `<code>${escapeHtml(rawJsonText)}</code>`;
    rawSearchCount.textContent = '0 results';
    currentMatchIndex = -1;
    return;
  }

  currentMatchIndex = 0;
  highlightMatches();
}

function highlightMatches() {
  if (searchMatches.length === 0) return;

  let html = '';
  let lastEnd = 0;

  searchMatches.forEach((match, idx) => {
    html += escapeHtml(rawJsonText.slice(lastEnd, match.start));
    const matchText = rawJsonText.slice(match.start, match.end);
    const isCurrent = idx === currentMatchIndex;
    html += `<span class="search-highlight${isCurrent ? ' current' : ''}" data-match="${idx}">${escapeHtml(matchText)}</span>`;
    lastEnd = match.end;
  });
  html += escapeHtml(rawJsonText.slice(lastEnd));

  rawJsonContent.innerHTML = `<code>${html}</code>`;
  rawSearchCount.textContent = `${currentMatchIndex + 1} / ${searchMatches.length}`;

  // Scroll current match into view
  const currentEl = rawJsonContent.querySelector('.search-highlight.current');
  if (currentEl) {
    currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function navigateMatch(delta) {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + delta + searchMatches.length) % searchMatches.length;
  highlightMatches();
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
