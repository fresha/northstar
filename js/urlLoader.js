/**
 * URL Loader - Handle loading queries from external sources
 * Supports: GitHub Gist, dpaste.com, raw JSON URLs
 */

/**
 * Load query from a URL
 */
export async function loadFromUrl(url) {
  // Local file path (relative to current origin)
  if (url.startsWith('file:')) {
    return await loadFromLocalFile(url.substring(5));
  }

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
 * Load from a local file path (relative to origin)
 */
async function loadFromLocalFile(path) {
  let response;
  try {
    response = await fetch(path);
  } catch (networkError) {
    throw new Error(`Failed to load local file: ${path}`);
  }

  if (!response.ok) {
    throw new Error(`Local file not found: ${path}`);
  }

  try {
    return await response.json();
  } catch (parseError) {
    throw new Error(`Invalid JSON in local file: ${path}`);
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
  let response;
  try {
    response = await fetch(`https://api.github.com/gists/${gistId}`);
  } catch (networkError) {
    throw new Error(`Network error loading Gist. Check your internet connection.`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Gist not found. It may have been deleted or made private.`);
    }
    if (response.status === 403) {
      throw new Error(`GitHub API rate limit exceeded. Try again later or use a dpaste link instead.`);
    }
    throw new Error(`Failed to load Gist: ${response.status} ${response.statusText}`);
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

  let response;
  try {
    response = await fetch(rawUrl);
  } catch (networkError) {
    // Network-level failure (CORS, offline, blocked by extension, etc.)
    throw new Error(`Network error loading paste. Check your internet connection or try disabling ad blockers.`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Paste not found. It may have expired or been deleted.`);
    }
    if (response.status === 429) {
      throw new Error(`Rate limited by dpaste.com. Please wait a moment and try again.`);
    }
    throw new Error(`Failed to load paste: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  try {
    return JSON.parse(content);
  } catch (parseError) {
    throw new Error(`Invalid JSON in paste. The paste may be corrupted.`);
  }
}

/**
 * Load from raw JSON URL
 */
async function loadFromRawUrl(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (networkError) {
    throw new Error(`Network error loading URL. The server may not allow cross-origin requests.`);
  }

  if (!response.ok) {
    throw new Error(`Failed to load URL: ${response.status} ${response.statusText}`);
  }

  try {
    return await response.json();
  } catch (parseError) {
    throw new Error(`Invalid JSON response from URL.`);
  }
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

  let response;
  try {
    response = await fetch('https://dpaste.com/api/', {
      method: 'POST',
      body: formData
    });
  } catch (networkError) {
    throw new Error(`Network error creating share link. Check your internet connection or try disabling ad blockers.`);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(`Rate limited by dpaste.com. Please wait a moment and try again.`);
    }
    throw new Error(`Failed to create share link: ${response.status} ${response.statusText}`);
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

  if (ref.startsWith('file:')) {
    const path = ref.substring(5);
    return { type: 'file', id: path, url: `file:${path}` };
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
  const rawHash = window.location.hash.replace(/^#/, '');

  const queryRef = urlParams.get('query');
  const optimisedRef = urlParams.get('optimised');

  // For new-format URLs (?query=...), hash can be "plan:14" (tab:nodeId)
  let hashTab = rawHash;
  let hashNode = null;
  if (queryRef && rawHash.includes(':')) {
    const parts = rawHash.split(':');
    hashTab = parts[0];
    hashNode = parts[1];
  }

  // Check for comparison: ?query=paste:ID&optimised=gist:ID
  if (queryRef && optimisedRef) {
    const baseline = parseSourceRef(queryRef);
    const optimised = parseSourceRef(optimisedRef);

    if (baseline && optimised) {
      return {
        type: 'compare',
        baseline,
        optimized: optimised,
        tab: hashTab || 'compare',
        node: hashNode ? parseInt(hashNode, 10) : null
      };
    }
  }

  // Single query: ?query=paste:ID or ?query=gist:ID
  if (queryRef) {
    const source = parseSourceRef(queryRef);
    if (source) {
      return {
        ...source,
        tab: hashTab || null,
        node: hashNode ? parseInt(hashNode, 10) : null
      };
    }
  }

  // Legacy format: #gist:ID or #paste:ID (fallback for old URLs)
  if (rawHash && (rawHash.startsWith('gist:') || rawHash.startsWith('paste:'))) {
    const source = parseSourceRef(rawHash);
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
