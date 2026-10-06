/**
 * Utility functions for parsing and formatting values
 */

// Parse values like "18.636 KB", "1.592ms", "3.336K (3336)" into numbers
export function parseNumericValue(str) {
  if (typeof str === 'number') return str;
  if (!str || str === '-' || str === 'N/A') return 0;
  
  str = String(str).trim();
  
  // Handle format like "3.336K (3336)" - extract the number in parentheses
  const parenMatch = str.match(/\((\d+)\)/);
  if (parenMatch) {
    return parseInt(parenMatch[1]);
  }

  // Handle byte formats FIRST (before time, to avoid conflicts): "18.636 KB", "1.045 GB"
  // Order matters: check longer units first (TB, GB, MB, KB before B)
  const byteMatch = str.match(/([\d.]+)\s*(TB|GB|MB|KB|B)\b/i);
  if (byteMatch) {
    const value = parseFloat(byteMatch[1]);
    const unit = byteMatch[2].toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
    return value * (multipliers[unit] || 1);
  }

  // Handle time formats: "1.592ms", "212.38us", "5s136ms", "1m43s", "2h5m".
  // StarRocks writes durations as one or more <number><unit> tokens; sum them all.
  // Unit alternatives are ordered so ms/us/ns win over m/s.
  if (/^(?:\d+(?:\.\d+)?\s*(?:h|ms|m|us|ns|s)\s*)+$/.test(str)) {
    const multipliers = { ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 };
    let total = 0;
    for (const [, value, unit] of str.matchAll(/(\d+(?:\.\d+)?)\s*(h|ms|m|us|ns|s)/g)) {
      total += parseFloat(value) * multipliers[unit];
    }
    return total;
  }

  // Try to parse as plain number
  const num = parseFloat(str.replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

// Sum a metric across all scans
export function sumMetric(scans, key, source) {
  return scans.reduce((sum, scan) => {
    const metrics = source === 'meta' ? scan : (source === 'common' ? scan.commonMetrics : scan.uniqueMetrics);
    return sum + parseNumericValue(metrics[key]);
  }, 0);
}

// Format large numbers
export function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
}

// Format bytes
export function formatBytes(bytes) {
  if (bytes >= 1024**4) return (bytes / 1024**4).toFixed(2) + ' TB';
  if (bytes >= 1024**3) return (bytes / 1024**3).toFixed(2) + ' GB';
  if (bytes >= 1024**2) return (bytes / 1024**2).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes.toFixed(2) + ' B';
}

// Format time (input in seconds, output human readable)
export function formatTime(seconds) {
  if (seconds === 0) return '0ns';

  // Convert to nanoseconds for precision
  const ns = seconds * 1e9;

  // Minutes and up: compound units like StarRocks ("1m 43s", "2h 5m"), not decimal minutes
  if (ns >= 60e9) {
    const totalSec = Math.round(seconds);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
  }
  if (ns >= 1e9) return (ns / 1e9).toFixed(2) + 's';
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
  if (ns >= 1e3) return (ns / 1e3).toFixed(2) + 'us';
  return ns.toFixed(0) + 'ns';
}

// Global tooltip system
let tooltipElement = null;

export function initTooltips() {
  // Create tooltip element if it doesn't exist
  if (!tooltipElement) {
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'global-tooltip';
    document.body.appendChild(tooltipElement);
  }

  // Event delegation for tooltip handling
  document.addEventListener('mouseenter', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      showTooltip(target);
    }
  }, true);

  document.addEventListener('mouseleave', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      hideTooltip();
    }
  }, true);
}

function showTooltip(element) {
  const text = element.dataset.tooltip;
  if (!text) return;

  tooltipElement.textContent = text;
  tooltipElement.classList.add('visible');

  // Position tooltip
  const rect = element.getBoundingClientRect();
  const tooltipRect = tooltipElement.getBoundingClientRect();

  // Default: center below the element
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  let top = rect.bottom + 8;

  // Keep within viewport horizontally
  const padding = 12;
  if (left < padding) {
    left = padding;
  } else if (left + tooltipRect.width > window.innerWidth - padding) {
    left = window.innerWidth - tooltipRect.width - padding;
  }

  // If tooltip would go below viewport, show above instead
  if (top + tooltipRect.height > window.innerHeight - padding) {
    top = rect.top - tooltipRect.height - 8;
  }

  tooltipElement.style.left = `${left}px`;
  tooltipElement.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipElement.classList.remove('visible');
}

// Health popup system for compaction health cells
let healthPopupElement = null;

export function initHealthPopups() {
  if (!healthPopupElement) {
    healthPopupElement = document.createElement('div');
    healthPopupElement.className = 'health-popup';
    document.body.appendChild(healthPopupElement);
  }

  document.addEventListener('mouseenter', (e) => {
    const target = e.target.closest('.has-health-popup');
    if (target) showHealthPopup(target);
  }, true);

  document.addEventListener('mouseleave', (e) => {
    const target = e.target.closest('.has-health-popup');
    if (target) hideHealthPopup();
  }, true);
}

function showHealthPopup(cell) {
  const raw = cell.dataset.health;
  if (!raw) return;

  const data = JSON.parse(raw);
  const labels = { ok: 'OK', recommended: 'Recommended', urgent: 'Urgent' };

  healthPopupElement.innerHTML = `
    <div class="health-popup-header health-${data.severity}">
      Compaction: ${labels[data.severity]}
    </div>
    ${data.reasons.map(r => `
      <div class="health-popup-row health-${r.severity}">
        <span class="health-popup-label">${r.label}</span>
        <span class="health-popup-value">${r.value}</span>
        <span class="health-popup-detail">${r.detail}</span>
      </div>
    `).join('')}
  `;

  healthPopupElement.classList.add('visible');

  // Position below cell
  const rect = cell.getBoundingClientRect();
  const popupRect = healthPopupElement.getBoundingClientRect();
  const padding = 12;

  let left = rect.left;
  let top = rect.bottom + 6;

  if (left + popupRect.width > window.innerWidth - padding) {
    left = window.innerWidth - popupRect.width - padding;
  }
  if (top + popupRect.height > window.innerHeight - padding) {
    top = rect.top - popupRect.height - 6;
  }

  healthPopupElement.style.left = `${left}px`;
  healthPopupElement.style.top = `${top}px`;
}

function hideHealthPopup() {
  healthPopupElement.classList.remove('visible');
}

