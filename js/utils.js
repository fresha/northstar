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

  // Handle time formats: "1.592ms", "103.060ms", "2s345ms", "26s134ms"
  // First try compound format like "26s134ms"
  const compoundTimeMatch = str.match(/(\d+)s(\d+)ms/i);
  if (compoundTimeMatch) {
    const seconds = parseInt(compoundTimeMatch[1]);
    const milliseconds = parseInt(compoundTimeMatch[2]);
    return seconds + (milliseconds / 1000);
  }
  
  // Simple time format
  const timeMatch = str.match(/([\d.]+)\s*(ns|us|ms|s|m|h)\b/i);
  if (timeMatch) {
    const value = parseFloat(timeMatch[1]);
    const unit = timeMatch[2].toLowerCase();
    const multipliers = { ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 };
    return value * (multipliers[unit] || 1);
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

  if (ns >= 3600e9) return (ns / 3600e9).toFixed(2) + 'h';
  if (ns >= 60e9) return (ns / 60e9).toFixed(2) + 'm';
  if (ns >= 1e9) return (ns / 1e9).toFixed(2) + 's';
  if (ns >= 1e6) return (ns / 1e6).toFixed(2) + 'ms';
  if (ns >= 1e3) return (ns / 1e3).toFixed(2) + 'us';
  return ns.toFixed(0) + 'ns';
}

