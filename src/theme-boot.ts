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
    // Storage blocked: light, as before the profile is read.
  }
  const dark = setting === 'dark'
    || (setting === 'system' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
})();
