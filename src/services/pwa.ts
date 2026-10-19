// Installable app and offline use (decision of 19.10.2026). The service worker (scripts/sw.template.js →
// public/sw.js) keeps every file of one build in the cache "hg-<stamp>"; this module registers it, offers
// "Neu laden" when a new build waits, and tracks how the app can be installed:
// - 'installed': already running as an app (display-mode standalone, or Safari's navigator.standalone).
// - 'prompt': the browser handed over its install prompt (beforeinstallprompt, Chromium); the settings show a
//   button that opens it.
// - 'ios': Safari on iPhone/iPad without that event; the settings explain Teilen › Zum Home-Bildschirm.
// - 'manual': elsewhere (e.g. Firefox); the settings point to the browser menu.
// installState and isIosDevice are pure (unit-tested); the rest touches browser globals only when called.
import { t } from '../i18n/de.js';
import { appUrl } from '../util/base.js';
import { buildHash } from '../util/dom.js';

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual';

export function installState(env: { standalone: boolean; prompt: boolean; ios: boolean }): InstallState {
  if (env.standalone) return 'installed';
  if (env.prompt) return 'prompt';
  return env.ios ? 'ios' : 'manual';
}

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isIosDevice(ua: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/u.test(ua)) return true;
  return /\bMacintosh\b/u.test(ua) && maxTouchPoints > 1;
}

/** Chromium's install prompt (not in lib.dom). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STICKY_MS = 120_000;
/** Look for a new build when the app returns to the foreground, at most this often. */
const UPDATE_EVERY_MS = 30 * 60_000;

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch (err) {
      console.error(err);
    }
  }
}

/** Called after every change of the install state; returns an unsubscribe function. */
export function onInstallChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function currentInstallState(): InstallState {
  return installState({ standalone: standalone(), prompt: deferred !== null, ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints) });
}

/** Opens the browser's install prompt; false when there is none. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted';
  } catch (err) {
    console.error(err);
    return false;
  }
}

/** Whether every file of this build is in the cache (null: the browser has no service worker or caches). */
export async function offlineReady(): Promise<boolean | null> {
  if (!('serviceWorker' in navigator) || typeof caches === 'undefined' || !window.isSecureContext) return null;
  try {
    return await caches.has(`hg-${buildHash()}`);
  } catch {
    return null;
  }
}

/** Registers the worker, the install prompt listeners and the "Neu laden" offer; call once at start. */
export function startPwa(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own banner away; the settings offer the install instead.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    // Only after "Neu laden": the very first worker also takes control, without a reload.
    if (!reloading) return;
    reloading = false;
    window.location.reload();
  });
  const offer = (worker: ServiceWorker): void => {
    if (!sw.controller) return;
    void import('../components/ol-toast.js').then(({ showToast }) => {
      showToast(t.pwaUpdateReady, {
        action: {
          label: t.pwaReload,
          onAction: () => {
            reloading = true;
            worker.postMessage({ type: 'skip-waiting' });
          },
        },
        duration: STICKY_MS,
      });
    });
  };
  void sw.register(appUrl('/sw.js'), { scope: appUrl('/') }).then((reg) => {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offer(worker);
        if (worker.state === 'activated') notify();
      });
    });
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < UPDATE_EVERY_MS) return;
      checked = Date.now();
      reg.update().catch(() => undefined);
    });
    void sw.ready.then(notify);
  }, (err: unknown) => console.error(err));
}
