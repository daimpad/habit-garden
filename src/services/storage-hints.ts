// Storage persistence, quota, Safari detection and the "Daten sichern" card logic (F §4.14).
import type { Profile } from '../model.js';
import { dayKey, dayOfIso, diffDays } from '../util/date.js';

export type PersistResult = 'granted' | 'denied' | 'unsupported';

/** Days without export after which the backup card appears. */
export const BACKUP_CARD_DAYS = 5;
/** How long a dismissed backup card stays hidden. */
export const BACKUP_CARD_SNOOZE_MS = 24 * 60 * 60 * 1000;

function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

/** navigator.storage.persist() (onboarding step 3). */
export async function requestPersist(): Promise<PersistResult> {
  const storage = storageManager();
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** navigator.storage.persisted(); null when unsupported. */
export async function isPersisted(): Promise<boolean | null> {
  const storage = storageManager();
  if (!storage || typeof storage.persisted !== 'function') return null;
  try {
    return await storage.persisted();
  } catch {
    return null;
  }
}

/** navigator.storage.estimate(); null when unsupported. */
export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  const storage = storageManager();
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const e = await storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Safari (desktop or iOS, any iOS browser engine) for the 7-day hint.
 * iOS: every browser there is WebKit (CriOS, FxiOS, EdgiOS …); iPadOS
 * reports a Mac user agent but has touch points.
 */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/u.test(ua) || (/Macintosh/u.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return true;
  return /Safari\//u.test(ua) && /Version\//u.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|Android/u.test(ua);
}

/**
 * "Daten sichern" card (A.2 H10): shown when ≥ 5 calendar days passed since
 * lastExportAt (or createdAt when never exported) and not dismissed within
 * the last 24 h. days = calendar days since the last export (null if never).
 */
export function backupCardState(profile: Profile, now: Date): { show: boolean; days: number | null } {
  const todayKey = dayKey(now);
  const since = (iso: string | undefined): number | null => {
    if (!iso || Number.isNaN(Date.parse(iso))) return null;
    return Math.max(0, diffDays(todayKey, dayOfIso(iso)));
  };
  const days = since(profile.lastExportAt);
  const baseline = days ?? since(profile.createdAt) ?? 0;
  let dismissed = false;
  if (profile.backupCardDismissedAt) {
    const elapsed = now.getTime() - Date.parse(profile.backupCardDismissedAt);
    dismissed = elapsed >= 0 && elapsed < BACKUP_CARD_SNOOZE_MS;
  }
  return { show: baseline >= BACKUP_CARD_DAYS && !dismissed, days };
}

const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/** Formats bytes for the settings ("12,3 MB"; decimal units, German decimal comma). */
export function formatBytes(bytes: number): string {
  let value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  let unit = 0;
  // Compare the rounded value so that 999 960 B reads "1 MB", not "1.000 kB".
  while (unit < UNITS.length - 1 && (unit === 0 ? value : Math.round(value * 10) / 10) >= 1000) {
    value /= 1000;
    unit++;
  }
  const text = new Intl.NumberFormat('de-DE', { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value);
  return `${text} ${UNITS[unit] ?? 'B'}`;
}
