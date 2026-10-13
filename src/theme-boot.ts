// Pre-paint theme (B.1, S38): a classic, render-blocking script in <head> (CSP script-src 'self',
// no inline code). It resolves the cached setting from localStorage 'theme' (written by main.ts;
// Profile.settings stays the source of truth) to html[data-theme], so a reload in dark mode never
// paints the light theme first. main.ts takes over after boot (including live system changes).
// No imports or exports: this file is compiled as a plain script, not as a module.
(() => {
  let setting: string | null = null;
  try {
    setting = localStorage.getItem('theme');
  } catch {
    // Storage blocked: follow the system, like a new profile.
  }
  // No cache yet (first visit): new profiles default to 'system' (decision 13.10.2026).
  const followSystem = setting === 'system' || setting === null;
  const dark = setting === 'dark'
    || (followSystem && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
})();
