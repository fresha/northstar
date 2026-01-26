/**
 * URL Loader - Handle loading queries from external sources
 * Supports: GitHub Gist, dpaste.com, raw JSON URLs
 */

/**
 * Load query from a URL
 */
export async function loadFromUrl(url) {
  // Detect URL type and load accordingly
  if (url.includes('gist.github.com') || url.includes('gist.githubusercontent.com') || url.includes('api.github.com/gists/')) {
    return await loadFromGist(url);
  } else if (url.includes('dpaste.com')) {
    return await loadFromDpaste(url);
  } else {
    // Try loading as raw JSON
    return await loadFromRawUrl(url);
  }
}

/**
 * Load from GitHub Gist
 */
async function loadFromGist(url) {
  // Extract gist ID from URL
  // Handles multiple formats:
  // - https://gist.github.com/username/gist_id
  // - https://gist.github.com/username/gist_id/raw/...
  // - https://gist.githubusercontent.com/username/gist_id/raw/...
  // - https://api.github.com/gists/gist_id (API URL)
  // - https://gist.github.com/gist_id (short format)

  let gistId = null;

  // Try API URL format first
  let match = url.match(/api\.github\.com\/gists\/([a-f0-9]{32})/i);

  // Try regular Gist URLs
  if (!match) {
    match = url.match(/gist\.github(?:usercontent)?\.com\/([a-f0-9]{32})/i);
  }
  if (!match) {
    match = url.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]{32})/i);
  }

  if (!match) {
    throw new Error('Invalid Gist URL format. Please provide a valid GitHub Gist URL.');
  }

  gistId = match[1].toLowerCase();

  // Always use GitHub API
  const response = await fetch(`https://api.github.com/gists/${gistId}`);
  if (!response.ok) {
    throw new Error(`Failed to load Gist: ${response.statusText}`);
  }

  const gist = await response.json();

  // Find the first JSON file in the gist
  const files = Object.values(gist.files);
  const jsonFile = files.find(f => f.filename.endsWith('.json'));

  if (!jsonFile) {
    throw new Error('No JSON file found in Gist');
  }

  // Parse and return the query
  return JSON.parse(jsonFile.content);
}

/**
 * Load from dpaste.com
 */
async function loadFromDpaste(url) {
  // Add .txt to get raw content if not present
  const rawUrl = url.endsWith('.txt') ? url : `${url}.txt`;

  const response = await fetch(rawUrl);
  if (!response.ok) {
    throw new Error(`Failed to load paste: ${response.statusText}`);
  }

  const content = await response.text();
  return JSON.parse(content);
}

/**
 * Load from raw JSON URL
 */
async function loadFromRawUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load URL: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Share query by creating a paste on dpaste.com
 * Returns the paste URL
 */
export async function shareToDpaste(queryJson) {
  const jsonString = JSON.stringify(queryJson, null, 2);

  // Create form data for dpaste API
  const formData = new FormData();
  formData.append('content', jsonString);
  formData.append('syntax', 'json');
  formData.append('expiry_days', '365'); // 1 year expiry

  const response = await fetch('https://dpaste.com/api/', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(`Failed to create paste: ${response.statusText}`);
  }

  // dpaste returns the URL in the response text
  const pasteUrl = (await response.text()).trim();
  return pasteUrl;
}

/**
 * Parse a source reference (paste:ID or gist:ID) and return URL info
 */
function parseSourceRef(ref) {
  if (!ref) return null;

  if (ref.startsWith('gist:')) {
    const id = ref.substring(5);
    return { type: 'gist', id, url: `https://api.github.com/gists/${id}` };
  }

  if (ref.startsWith('paste:')) {
    const id = ref.substring(6);
    return { type: 'paste', id, url: `https://dpaste.com/${id}` };
  }

  return null;
}

/**
 * Parse a NorthStar URL and extract the external URL reference
 *
 * URL format (query params + hash for tab):
 *   Single query: ?query=paste:ID#scan or ?query=gist:ID#plan
 *   Comparison:   ?query=paste:ID&optimised=gist:ID#compare
 *
 * Source format: {type}:{id} where type is 'paste' (dpaste.com) or 'gist' (GitHub)
 * Note: 'query' serves as both single query AND baseline for comparisons
 */
export function parseNorthStarUrl(hash) {
  const urlParams = new URLSearchParams(window.location.search);
  const hashTab = window.location.hash.replace(/^#/, '');

  const queryRef = urlParams.get('query');
  const optimisedRef = urlParams.get('optimised');

  // Check for comparison: ?query=paste:ID&optimised=gist:ID
  if (queryRef && optimisedRef) {
    const baseline = parseSourceRef(queryRef);
    const optimised = parseSourceRef(optimisedRef);

    if (baseline && optimised) {
      return {
        type: 'compare',
        baseline,
        optimized: optimised,
        tab: hashTab || 'compare'
      };
    }
  }

  // Single query: ?query=paste:ID or ?query=gist:ID
  if (queryRef) {
    const source = parseSourceRef(queryRef);
    if (source) {
      return {
        ...source,
        tab: hashTab || null
      };
    }
  }

  // Legacy format: #gist:ID or #paste:ID (fallback for old URLs)
  if (hashTab && (hashTab.startsWith('gist:') || hashTab.startsWith('paste:'))) {
    const source = parseSourceRef(hashTab);
    if (source) {
      return {
        ...source,
        tab: null // No tab info in legacy format
      };
    }
  }

  return null;
}

/**
 * Build a shareable URL for a single query
 */
export function buildQueryUrl(source) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?query=${source.type}:${source.id}`;
}

/**
 * Build a shareable URL for a comparison
 */
export function buildCompareUrl(baselineSource, optimisedSource) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?query=${baselineSource.type}:${baselineSource.id}&optimised=${optimisedSource.type}:${optimisedSource.id}#compare`;
}

/**
 * Extract Gist ID from any Gist URL format
 * Handles gist.github.com, gist.githubusercontent.com, and API URLs
 */
export function extractGistId(url) {
  // Try API URL format first
  let match = url.match(/api\.github\.com\/gists\/([a-f0-9]{32})/i);

  // Try regular Gist URLs
  if (!match) {
    match = url.match(/gist\.github(?:usercontent)?\.com\/([a-f0-9]{32})/i);
  }
  if (!match) {
    match = url.match(/gist\.github(?:usercontent)?\.com\/[^/]+\/([a-f0-9]{32})/i);
  }

  // Also handle NorthStar URL format: #gist:ID
  if (!match) {
    match = url.match(/#gist:([a-f0-9]{32})/i);
  }

  return match ? match[1].toLowerCase() : null;
}

/**
 * Extract paste ID from dpaste URL or NorthStar URL
 */
export function extractPasteId(url) {
  // First try dpaste.com URL format
  let match = url.match(/dpaste\.com\/([a-zA-Z0-9]+)/);

  // Also handle NorthStar URL format: #paste:ID
  if (!match) {
    match = url.match(/#paste:([a-zA-Z0-9]+)/);
  }

  return match ? match[1] : null;
}
