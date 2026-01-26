/**
 * Global Query State Management
 * Handles:
 * - Central query storage
 * - External URL references (gist/paste)
 * - State change notifications to all tabs
 *
 * Note: No localStorage persistence - queries live in external services
 */

import { loadFromUrl, parseNorthStarUrl, buildQueryUrl } from './urlLoader.js';

// Current query JSON
let currentQuery = null;

// Query source info (for reusing on share)
let querySource = null; // { type: 'gist|paste', id: '...', url: '...' }

// Listeners for state changes
const listeners = [];

// Loading overlay helpers
function showLoading(message) {
  const overlay = document.getElementById('loadingOverlay');
  const messageEl = document.getElementById('loadingMessage');
  if (overlay) {
    overlay.style.display = 'flex';
    if (messageEl) messageEl.textContent = message;
  }
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Initialize query state from URL only
 * Checks for ?query=... and ?optimised=... format
 * Returns { loaded: boolean, tab: string|null, isCompare: boolean, compareData?: {...} }
 */
export async function initQueryState() {
  const hash = window.location.hash;
  const hasQueryParams = window.location.search.includes('query=');

  if (!hash && !hasQueryParams) return { loaded: false, tab: null, isCompare: false };

  try {
    const parsed = parseNorthStarUrl(hash);
    if (parsed) {
      // Handle comparison URL
      if (parsed.type === 'compare') {
        showLoading('Loading baseline query...');
        const baselineJson = await loadFromUrl(parsed.baseline.url);

        // Delay for dpaste rate limit (1 req/sec)
        if (parsed.baseline.url.includes('dpaste.com') && parsed.optimized.url.includes('dpaste.com')) {
          showLoading('Loading optimised query...');
          await new Promise(r => setTimeout(r, 1100));
        } else {
          showLoading('Loading optimised query...');
        }

        const optimizedJson = await loadFromUrl(parsed.optimized.url);
        hideLoading();

        // Also set baseline as the main query so other tabs can use it
        currentQuery = baselineJson;
        querySource = parsed.baseline;
        notifyListeners();

        return {
          loaded: true,
          tab: parsed.tab || 'compare',
          isCompare: true,
          compareData: {
            baselineJson,
            optimizedJson,
            source: {
              baseline: { type: parsed.baseline.type, id: parsed.baseline.id },
              optimized: { type: parsed.optimized.type, id: parsed.optimized.id }
            }
          }
        };
      }

      // Load from external URL (gist or paste)
      showLoading('Loading query...');
      const query = await loadFromUrl(parsed.url);
      hideLoading();

      currentQuery = query;
      querySource = parsed; // Store source for reuse
      notifyListeners();
      return { loaded: true, tab: parsed.tab, isCompare: false };
    }
  } catch (error) {
    hideLoading();
    console.error('Failed to load query from URL:', error);
    throw error; // Re-throw so caller can show user-visible error
  }

  return { loaded: false, tab: null, isCompare: false };
}

/**
 * Get the current query
 */
export function getQuery() {
  return currentQuery;
}

/**
 * Set a new query (from file upload or other source)
 * @param {Object} queryJson - The query data
 * @param {Object} source - Optional source info { type, id, url }
 */
export function setQuery(queryJson, source = null) {
  currentQuery = queryJson;
  querySource = source;

  // Update URL if source is provided (using new query param format)
  if (source && (source.type === 'gist' || source.type === 'paste')) {
    const newUrl = buildQueryUrl(source);
    window.history.replaceState(null, '', newUrl);
  }

  // Notify all listeners
  notifyListeners();
}

/**
 * Get the query source (for reusing on share)
 */
export function getQuerySource() {
  return querySource;
}

/**
 * Clear the current query
 */
export function clearQuery() {
  currentQuery = null;
  querySource = null;
  clearHash();
  notifyListeners();
}

/**
 * Add a listener for query changes
 * Listener will be called with the new query (or null if cleared)
 */
export function addListener(callback) {
  listeners.push(callback);
}

/**
 * Remove a listener
 */
export function removeListener(callback) {
  const index = listeners.indexOf(callback);
  if (index > -1) {
    listeners.splice(index, 1);
  }
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
  listeners.forEach(callback => {
    try {
      callback(currentQuery);
    } catch (error) {
      console.error('Error in query state listener:', error);
    }
  });
}

/**
 * Clear URL hash
 */
function clearHash() {
  window.history.replaceState(null, '', window.location.pathname);
}

/**
 * Check if a query is currently loaded
 */
export function hasQuery() {
  return currentQuery !== null;
}

/**
 * Get a shareable URL for the current query
 * This is now handled by the Share button which creates a paste
 */
export function getShareableUrl() {
  // This function is no longer used - sharing is done via dpaste
  return window.location.href;
}
