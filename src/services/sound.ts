// Klänge (decision of 20.10.2026): short natural sounds at a few moments, on and quiet by default, switchable in
// Einstellungen › Darstellung (Aus · Leise · Normal). Generated with ElevenLabs Sound Effects, trimmed and
// levelled once (docs/klaenge.md), shipped under public/assets/sounds/ (so the service worker keeps them offline).
//
// Moments: water (a routine watered), grow (a plant reached the next stage), bloom (full bloom, instead of grow),
// milestone (a "Spur im Garten" earned), tap (a task done), fire ("Ins Feuer erzählen" saved), keimi (Keimi
// greets: the tour starts or ends, the evening question appears).
//
// Rules (pure parts unit-tested in __tests__/sound.test.ts):
// - Nothing plays with the level 'off', while the page is hidden, or before the first user gesture (browsers
//   only start audio after one; the AudioContext is created on the first pointerdown/keydown).
// - Safari: navigator.audioSession.type = 'ambient', so the sounds mix with other audio and follow the silent
//   switch; elsewhere the media volume applies.
// - The same sound does not repeat within REPEAT_MS; a sound right after a more notable one (PRIORITY) within
//   YIELD_MS is left out, so watering that also grows a plant and earns a milestone stays one calm sound each.
// - Files load and decode once shortly after start (an OfflineAudioContext needs no gesture), so the first tap
//   already sounds. A sound asked for while its file or the audio start is still on its way plays if that takes
//   at most FRESH_MS; later it is dropped, never queued.
import { appUrl } from '../util/base.js';

export type SoundId = 'water' | 'grow' | 'bloom' | 'milestone' | 'tap' | 'fire' | 'keimi';
export type SoundLevel = 'off' | 'soft' | 'normal';

export const SOUND_IDS: readonly SoundId[] = ['water', 'grow', 'bloom', 'milestone', 'tap', 'fire', 'keimi'];
export const SOUND_LEVELS: readonly SoundLevel[] = ['off', 'soft', 'normal'];
export const DEFAULT_SOUND_LEVEL: SoundLevel = 'soft';

/** Master gain per level. */
export const LEVEL_GAIN: Readonly<Record<SoundLevel, number>> = { off: 0, soft: 0.35, normal: 0.7 };
/** Balance between the sounds (the files are levelled already; this keeps the frequent ones lighter). */
export const SOUND_GAIN: Readonly<Record<SoundId, number>> = {
  water: 0.8, grow: 0.7, bloom: 0.8, milestone: 0.9, tap: 0.6, fire: 0.8, keimi: 0.6,
};
/** Higher wins when two sounds meet within YIELD_MS. */
export const PRIORITY: Readonly<Record<SoundId, number>> = {
  tap: 1, water: 1, keimi: 2, grow: 2, fire: 3, bloom: 3, milestone: 4,
};
export const REPEAT_MS = 120;
export const YIELD_MS = 400;
export const FRESH_MS = 600;
const PRELOAD_DELAY_MS = 1200;

export function isSoundLevel(value: unknown): value is SoundLevel {
  return typeof value === 'string' && (SOUND_LEVELS as readonly string[]).includes(value);
}

/** Pure: may `id` play at `now`, given the level, page visibility and the last sound played. */
export function mayPlay(id: SoundId, now: number, state: {
  level: SoundLevel; hidden: boolean; last: { id: SoundId; at: number } | null;
}): boolean {
  if (state.level === 'off' || state.hidden) return false;
  const last = state.last;
  if (!last) return true;
  const since = now - last.at;
  if (last.id === id) return since >= REPEAT_MS;
  return since >= YIELD_MS || PRIORITY[id] > PRIORITY[last.id];
}

export function soundUrl(id: SoundId): string {
  return appUrl(`assets/sounds/${id}.mp3`);
}

// --- Browser side (touches globals only when called) ---

let level: SoundLevel = DEFAULT_SOUND_LEVEL;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let last: { id: SoundId; at: number } | null = null;
const buffers = new Map<SoundId, AudioBuffer>();
let loading: Promise<void> | null = null;
let armed = false;

/** Safari 17+: mix with other audio and respect the silent switch (not in lib.dom). */
function ambientSession(): void {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'ambient';
    } catch {
      // Older implementations: keep the default.
    }
  }
}

/** Fetches and decodes every file once (decoding in an OfflineAudioContext when there is no live one yet). */
function loadAll(): Promise<void> {
  if (loading) return loading;
  let decoder: BaseAudioContext | null = ctx;
  try {
    decoder ??= typeof OfflineAudioContext === 'function' ? new OfflineAudioContext(1, 1, 44_100) : null;
  } catch {
    decoder = null;
  }
  if (!decoder) return Promise.resolve();
  const context = decoder;
  loading = Promise.all(SOUND_IDS.map(async (id) => {
    try {
      const response = await fetch(soundUrl(id));
      if (!response.ok) return;
      buffers.set(id, await context.decodeAudioData(await response.arrayBuffer()));
    } catch {
      // A missing or undecodable file only silences that moment.
    }
  })).then(() => undefined);
  return loading;
}

/** Creates (or resumes) the AudioContext inside a user gesture and starts loading the files. */
function unlock(): void {
  if (level === 'off') return;
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!ctx) {
      ambientSession();
      ctx = new Ctor({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = LEVEL_GAIN[level];
      master.connect(ctx.destination);
      void loadAll();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    master = null;
  }
}

/** Once at start: listen for the gestures that may start audio (capture, passive, never prevents anything). */
export function initSound(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const opts = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  window.setTimeout(() => {
    if (level !== 'off') void loadAll();
  }, PRELOAD_DELAY_MS);
}

export function setSoundLevel(next: SoundLevel): void {
  level = next;
  if (master && ctx) master.gain.setTargetAtTime(LEVEL_GAIN[next], ctx.currentTime, 0.02);
  if (next !== 'off' && armed) void loadAll();
}

export function soundLevel(): SoundLevel {
  return level;
}

function start(id: SoundId, buffer: AudioBuffer): void {
  if (!ctx || !master || ctx.state !== 'running') return;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  gain.gain.value = SOUND_GAIN[id];
  source.buffer = buffer;
  source.connect(gain).connect(master);
  source.start();
}

/** Plays a sound if the rules allow it; never throws. */
export function playSound(id: SoundId): void {
  try {
    const asked = performance.now();
    if (!mayPlay(id, asked, { level, hidden: document.visibilityState === 'hidden', last })) return;
    const context = ctx;
    if (!context || !master) return;
    last = { id, at: asked };
    const buffer = buffers.get(id);
    if (buffer && context.state === 'running') {
      start(id, buffer);
      return;
    }
    // The file or the audio start is still on its way (first tap after opening the app).
    const ready = context.state === 'running' ? Promise.resolve() : context.resume();
    void Promise.all([ready, buffer ? null : loadAll()]).then(() => {
      const late = buffers.get(id);
      if (late && level !== 'off' && performance.now() - asked <= FRESH_MS) start(id, late);
    }, () => undefined);
  } catch {
    // Audio is decoration; a failure never reaches the flow that asked for it.
  }
}

/** Settings preview: unlock inside the gesture that chose the level, then play the water drop. */
export function previewSound(): void {
  unlock();
  last = null;
  playSound('water');
}
