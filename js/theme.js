/**
 * Theme Manager - Dark/Light mode switching with Nord palette
 */

const STORAGE_KEY = 'northstar-theme';
const DARK = 'dark';
const LIGHT = 'light';

/**
 * Initialize theme system
 * - Check localStorage for saved preference
 * - Fall back to system preference
 * - Set up toggle button listener
 */
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  // Determine initial theme
  const theme = saved || (systemPrefersDark ? DARK : LIGHT);
  setTheme(theme);

  // Listen for toggle button
  const toggleBtn = document.getElementById('themeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleTheme);
  }

  // Listen for system preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    // Only auto-switch if user hasn't manually set a preference
    if (!localStorage.getItem(STORAGE_KEY)) {
      setTheme(e.matches ? DARK : LIGHT);
    }
  });
}

/**
 * Set theme and persist to localStorage
 */
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Toggle between dark and light themes
 */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || DARK;
  const next = current === DARK ? LIGHT : DARK;
  setTheme(next);
}

/**
 * Get current theme
 */
export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || DARK;
}
