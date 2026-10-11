// CONTRACT STUB – implemented in AP5.
import type { Profile } from '../model.js';

export type PersistResult = 'granted' | 'denied' | 'unsupported';

/** navigator.storage.persist() (onboarding step 3). */
export function requestPersist(): Promise<PersistResult> {
  throw new Error('not implemented: requestPersist');
}

/** navigator.storage.persisted(); null when unsupported. */
export function isPersisted(): Promise<boolean | null> {
  throw new Error('not implemented: isPersisted');
}

/** navigator.storage.estimate(); null when unsupported. */
export function estimate(): Promise<{ usage: number; quota: number } | null> {
  throw new Error('not implemented: estimate');
}

/** Safari (desktop or iOS, any iOS browser engine) for the 7-day hint. */
export function isSafari(): boolean {
  throw new Error('not implemented: isSafari');
}

/**
 * "Daten sichern" card (A.2 H10): shown when ≥ 5 calendar days passed since
 * lastExportAt (or createdAt when never exported) and not dismissed within
 * the last 24 h. days = calendar days since the last export (null if never).
 */
export function backupCardState(profile: Profile, now: Date): { show: boolean; days: number | null } {
  throw new Error(`not implemented: backupCardState ${profile.key} ${now.getTime()}`);
}

/** Formats bytes for the settings ("12,3 MB"). */
export function formatBytes(bytes: number): string {
  throw new Error(`not implemented: formatBytes ${bytes}`);
}
