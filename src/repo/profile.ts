// CONTRACT STUB – implemented in AP5. Signatures are binding; bodies are placeholders.
import type { Observable } from 'dexie';
import type { Area, Profile } from '../model.js';

/** Stored profile, or an unsaved default profile (onboardingDone 0) before onboarding. */
export function getProfile(): Promise<Profile> {
  throw new Error('not implemented: getProfile');
}

/** liveQuery of the profile (default profile while none is stored). */
export function profile$(): Observable<Profile> {
  throw new Error('not implemented: profile$');
}

export function updateSettings(patch: Partial<Profile['settings']>): Promise<void> {
  throw new Error('not implemented: updateSettings');
}

/** Updates top-level profile fields (lastExportAt, backupCardDismissedAt, firstStepsDismissed). */
export function updateProfile(patch: Partial<Omit<Profile, 'key' | 'settings' | 'schemaVersion'>>): Promise<void> {
  throw new Error('not implemented: updateProfile');
}

/**
 * Onboarding end (F §4.13): one transaction creates the profile (onboardingDone 1)
 * and the selected areas in the given order. An empty selection creates
 * "Wohnen & Alltag" (leucanthemum) as the only area (acceptance 3).
 */
export function completeOnboarding(areas: ReadonlyArray<Pick<Area, 'name' | 'flower' | 'tint'>>): Promise<void> {
  throw new Error('not implemented: completeOnboarding');
}
