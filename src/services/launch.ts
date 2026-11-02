// Schneller Zugriff (decision of 02.11.2026): the app icon's shortcuts and the share target open the app with a
// small query (manifest.webmanifest). Pure (unit-tested in __tests__/launch.test.ts); main.ts reads it once at
// start, removes it from the address bar and acts after the router has started (only after the onboarding).
// - ?do=water → HEUTE at the routines · ?do=mood → HEUTE at the mood · ?do=task → capture sheet (task) ·
//   ?do=note → a new note in the editor.
// - Share target (Android, installed app): ?st=<title>&sx=<text>&su=<url> → the capture sheet pre-filled with
//   one line made of them (title, text and link without repeats, at most SHARE_MAX characters); the person
//   chooses task or note there.

export type LaunchAction = 'water' | 'mood' | 'task' | 'note';
export type Launch = { action: LaunchAction } | { share: string } | null;

export const SHARE_MAX = 500;
const ACTIONS: readonly LaunchAction[] = ['water', 'mood', 'task', 'note'];
const KEYS = ['do', 'st', 'sx', 'su'] as const;

/** Reads the launch query ("?do=task", "?st=…&su=…"); null when there is none. */
export function parseLaunch(search: string): Launch {
  const params = new URLSearchParams(search);
  const action = params.get('do');
  if (action && (ACTIONS as readonly string[]).includes(action)) return { action: action as LaunchAction };
  const parts = [params.get('st'), params.get('sx'), params.get('su')]
    .map((p) => (p ?? '').replace(/\s+/gu, ' ').trim())
    .filter((p) => p !== '');
  const unique: string[] = [];
  for (const p of parts) {
    // Apps often put the link into the text as well: keep each piece once.
    if (unique.some((u) => u.includes(p))) continue;
    for (let i = unique.length - 1; i >= 0; i--) if (p.includes(unique[i] ?? '')) unique.splice(i, 1);
    unique.push(p);
  }
  const text = unique.join(' ').slice(0, SHARE_MAX).trim();
  return text ? { share: text } : null;
}

/** The query without the launch keys (other parameters stay), with "?" or empty. */
export function stripLaunch(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of KEYS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
