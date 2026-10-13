import { liveQuery, type Observable } from 'dexie';
import { db } from '../db.js';
import { DEFAULT_AREAS, DEFAULT_SETTINGS, SCHEMA_VERSION, type Area, type Profile } from '../model.js';
import { nowIso } from '../util/date.js';
import { newId, sortKeyBetween } from '../util/ids.js';

/** A fresh, unsaved profile (onboardingDone 0). */
export function defaultProfile(): Profile {
  return {
    key: 'profile',
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    onboardingDone: 0,
    createdAt: nowIso(),
  };
}

/**
 * One-time upgrade of a stored or imported profile to SCHEMA_VERSION (in place, returns it).
 * Schema 1 → 2: no UI could set settings.landscape before Phase 5, so its stored 0 is the old
 * default and becomes 1 (on); a missing or invalid value is on as well. Reads upgrade on the fly
 * (liveQuery cannot write); the next profile write stores the upgraded record.
 */
export function upgradeProfile(profile: Profile): Profile {
  if (!(profile.schemaVersion >= 2)) {
    profile.settings.landscape = 1;
    profile.schemaVersion = SCHEMA_VERSION;
  } else if (profile.settings.landscape !== 0 && profile.settings.landscape !== 1) {
    profile.settings.landscape = 1;
  }
  return profile;
}

/** Stored profile, or an unsaved default profile (onboardingDone 0) before onboarding. */
export async function getProfile(): Promise<Profile> {
  const stored = await db.profile.get('profile');
  return stored ? upgradeProfile(stored) : defaultProfile();
}

/** liveQuery of the profile (default profile while none is stored). */
export function profile$(): Observable<Profile> {
  return liveQuery(getProfile);
}

/** Read-modify-write of the stored profile (created from the default when missing). */
function mutateProfile(fn: (profile: Profile) => void): Promise<void> {
  return db.transaction('rw', db.profile, async () => {
    const profile = upgradeProfile(structuredClone((await db.profile.get('profile')) ?? defaultProfile()));
    fn(profile);
    profile.key = 'profile';
    await db.profile.put(profile);
  });
}

export function updateSettings(patch: Partial<Profile['settings']>): Promise<void> {
  return mutateProfile((profile) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (profile.settings as Record<string, unknown>)[key] = value;
    }
  });
}

/**
 * Updates top-level profile fields (lastExportAt, backupCardDismissedAt, firstStepsDismissed).
 * undefined clears an optional field.
 */
export function updateProfile(patch: Partial<Omit<Profile, 'key' | 'settings' | 'schemaVersion'>>): Promise<void> {
  return mutateProfile((profile) => {
    const target = profile as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) target[key] = value;
      else if (key !== 'onboardingDone' && key !== 'createdAt') delete target[key];
    }
  });
}

/**
 * Onboarding end (F §4.13): one transaction creates the profile (onboardingDone 1)
 * and the selected areas in the given order. An empty selection creates
 * "Wohnen & Alltag" (leucanthemum) as the only area (acceptance 3).
 * Areas that already exist with the same name and flower are not duplicated.
 */
export function completeOnboarding(areas: ReadonlyArray<Pick<Area, 'name' | 'flower' | 'tint'>>): Promise<void> {
  const chosen = areas
    .map((a) => ({ name: a.name.trim(), flower: a.flower, tint: a.tint }))
    .filter((a) => a.name !== '');
  if (chosen.length === 0) {
    const fallback = DEFAULT_AREAS.find((a) => a.flower === 'leucanthemum');
    if (fallback) chosen.push({ ...fallback });
  }
  return db.transaction('rw', db.profile, db.areas, async () => {
    const stamp = nowIso();
    const profile = upgradeProfile(structuredClone((await db.profile.get('profile')) ?? defaultProfile()));
    profile.onboardingDone = 1;
    await db.profile.put(profile);
    const existing = await db.areas.orderBy('sortKey').toArray();
    let last = existing[existing.length - 1]?.sortKey ?? null;
    const seen = new Set(existing.map((a) => `${a.flower}|${a.name}`));
    const created: Area[] = [];
    for (const input of chosen) {
      const key = `${input.flower}|${input.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      last = sortKeyBetween(last, null);
      created.push({ id: newId(), ...input, sortKey: last, archived: 0, updatedAt: stamp });
    }
    if (created.length > 0) await db.areas.bulkAdd(created);
  });
}
