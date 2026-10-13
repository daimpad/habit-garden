// Rückblick /heute/rueckblick (A.2 H9, B.5): KPI tiles, fulfilment rings per routine, best streaks with a
// miniature plant of the reached stage, weekday rhythm and the mood trend of the last 30 days.
// All values come live from the logs (services/review.ts); every chart has a text equivalent (legend
// lists, a visually hidden weekday list, the mood summary), the SVG drawings themselves are aria-hidden.
//
// Details of this implementation:
// - Read-only screen: each liveQuery emission re-renders the body (nothing focusable inside but the app
//   bar, which stays). Content stays hidden (data-loading) until every source has delivered once.
// - Motion (B.5): on the first render only, the rings run stroke-dashoffset 600 ms, the streak bars
//   scaleX 500 ms and the weekday bars scaleY 500 ms; under reduced motion the final state shows at once.
//   Final values are SVG attributes or CSS custom properties (setVar), never style="" (CSP).
// - Colours come from tokens; ring strokes, swatches and plants use the area tint (data).
// - Rings: at most RING_MAX (outer → inner in list order); the legend lists every active routine.
import '../components/ol-app-bar.js';
import '../components/ol-card.js';
import '../components/ol-empty-state.js';
import type { Observable, Subscription } from 'dexie';
import { plant, safeTint } from '../components/flora.js';
import { fmt, moodLabel, stageName, t, weekdayShort } from '../i18n/de.js';
import { GENERIC_TINT, type Area, type ContactLog, type Day, type FlowerId, type Habit, type HabitLog, type Id, type MoodLog } from '../model.js';
import { areas$ } from '../repo/areas.js';
import { contactLogs$ } from '../repo/contacts.js';
import { logsByHabit$ } from '../repo/habitLogs.js';
import { habits$ } from '../repo/habits.js';
import { moodsBetween$ } from '../repo/moodLogs.js';
import type { Route } from '../router.js';
import { lastDays, percent, review, type BestStreak, type MoodTrend, type Review, type Rhythm } from '../services/review.js';
import { addDays, formatDayShort, formatWeekdayLong, isoWeekday, today } from '../util/date.js';
import { h, motionReduced, raw, render, setVar, type SafeHtml } from '../util/dom.js';
import { openCapture } from './sheets/capture.js';

const RING_MAX = 8;
const RING_BOX = 200;
const RING_OUTER = 94;
const RING_MS = 600;
const BAR_MS = 500;
const EASE = 'cubic-bezier(.2,0,0,1)';
const PLANT_SIZE = 40;

// Mood chart geometry (viewBox units).
const MOOD_W = 320;
const MOOD_H = 120;
const MOOD_LEFT = 18;
const MOOD_RIGHT = 8;
const MOOD_TOP = 10;
const MOOD_STEP = 24;

const num1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fix = (v: number): string => (Math.round(v * 100) / 100).toString();

export function mount(view: HTMLElement, route: Route): () => void {
  void route;
  const screen = new ReviewScreen(view, today());
  screen.start();
  return () => screen.destroy();
}

function streakText(s: BestStreak): string {
  if (s.unit === 'weeks') return s.best === 1 ? t.streakWeeksOne : fmt(t.streakWeeks, { n: s.best });
  return s.best === 1 ? t.dayCountOne : fmt(t.dayCount, { n: s.best });
}

function pctText(rate: number | null): string {
  const p = percent(rate);
  return p === null ? t.reviewNone : fmt(t.reviewPercent, { n: p });
}

class ReviewScreen {
  private readonly view: HTMLElement;
  private readonly day: Day;
  private readonly body: HTMLElement;
  private readonly root: HTMLElement;
  private readonly periodEl: HTMLElement;
  private readonly subs: Subscription[] = [];
  private logsSub: Subscription | null = null;
  private logsKey: string | null = null;
  private destroyed = false;
  private animated = false;

  private habits: Habit[] | null = null;
  private areas: Map<Id, Area> | null = null;
  private logs: Map<Id, HabitLog[]> | null = null;
  private moods: MoodLog[] | null = null;
  private contactLogs: ContactLog[] | null = null;

  constructor(view: HTMLElement, day: Day) {
    this.view = view;
    this.day = day;
    render(view, h`
      <ol-app-bar back heading="${t.reviewTitle}"></ol-app-bar>
      <div class="ol-review" data-loading>
        <p class="ol-review__period ol-caption"></p>
        <div class="ol-review__body"></div>
      </div>`);
    this.root = view.querySelector<HTMLElement>('.ol-review') ?? view;
    this.body = view.querySelector<HTMLElement>('.ol-review__body') ?? view;
    this.periodEl = view.querySelector<HTMLElement>('.ol-review__period') ?? view;
    this.body.addEventListener('ol-action', () => {
      try {
        openCapture({ type: 'habit' });
      } catch (err) {
        console.error(err);
      }
    });
  }

  start(): void {
    const period = lastDays(this.day);
    this.periodEl.textContent = fmt(t.reviewPeriod, { from: formatDayShort(period.from), to: formatDayShort(period.to) });
    this.watch(habits$(), (list) => {
      this.habits = list;
      this.watchLogs(list);
    });
    this.watch(areas$(true), (list) => {
      this.areas = new Map(list.map((a) => [a.id, a]));
    });
    this.watch(moodsBetween$(period.from, period.to), (list) => {
      this.moods = list;
    });
    this.watch(contactLogs$(), (list) => {
      this.contactLogs = list;
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const sub of this.subs) sub.unsubscribe();
    this.subs.length = 0;
    this.logsSub?.unsubscribe();
    this.logsSub = null;
  }

  private watch<T>(source: Observable<T>, next: (v: T) => void): void {
    this.subs.push(source.subscribe({
      next: (value: T) => {
        if (this.destroyed) return;
        try {
          next(value);
          this.render();
        } catch (err) {
          console.error(err);
        }
      },
      error: (err: unknown) => console.error(err),
    }));
  }

  private watchLogs(habits: readonly Habit[]): void {
    const ids = habits.map((hb) => hb.id).sort();
    const key = ids.join('|');
    if (key === this.logsKey) return;
    this.logsKey = key;
    this.logsSub?.unsubscribe();
    this.logs = null;
    this.logsSub = logsByHabit$(ids).subscribe({
      next: (map) => {
        if (this.destroyed) return;
        this.logs = map;
        try {
          this.render();
        } catch (err) {
          console.error(err);
        }
      },
      error: (err: unknown) => console.error(err),
    });
  }

  private flowerOf(habit: Habit): { flower: FlowerId; tint: string } {
    const area = habit.areaId ? this.areas?.get(habit.areaId) : undefined;
    return area ? { flower: area.flower, tint: safeTint(area.tint) } : { flower: 'generic', tint: GENERIC_TINT };
  }

  // --- Rendering ---

  private render(): void {
    const { habits, areas, logs, moods, contactLogs } = this;
    if (!habits || !areas || !logs || !moods || !contactLogs) return;
    const data = review({ habits, logs, moods, contactLogs, today: this.day });
    const parts: SafeHtml[] = [this.kpis(data)];
    if (data.active === 0) {
      parts.push(h`<ol-card class="ol-review__empty"><ol-empty-state compact icon="sprout" message="${t.reviewEmpty}" action="${t.actionCreateHabit}"></ol-empty-state></ol-card>`);
    } else {
      parts.push(this.rings(data), this.streaks(data));
    }
    parts.push(this.rhythm(data.rhythm), this.mood(data.mood));
    render(this.body, h`${parts}`);
    this.applyVars();
    this.root.removeAttribute('data-loading');
    if (!this.animated) {
      this.animated = true;
      if (!motionReduced()) this.animateIn();
    }
  }

  private kpis(data: Review): SafeHtml {
    const longest = data.longest;
    const mood = data.mood;
    const tile = (label: string, value: string, sub: string): SafeHtml => h`
      <li class="ol-review__kpi">
        <span class="ol-review__kpi-label ol-caption">${label}</span>
        <span class="ol-review__kpi-value ol-num">${value}</span>
        <span class="ol-review__kpi-sub ol-caption">${sub}</span>
      </li>`;
    return h`<ul class="ol-review__kpis" aria-label="${t.reviewKpiAria}">
      ${tile(t.reviewKpiRate, pctText(data.rate), data.rate === null ? t.reviewKpiRateNone : t.reviewKpiRateSub)}
      ${tile(t.reviewKpiStreak, longest ? streakText(longest) : t.reviewNone, longest ? longest.habit.name : t.reviewKpiStreakNone)}
      ${tile(t.reviewKpiActive, String(data.active), t.reviewKpiActiveSub)}
      ${tile(t.reviewKpiMood, mood.average === null ? t.reviewNone : num1.format(mood.average), mood.average === null ? t.reviewKpiMoodNone : t.reviewKpiMoodSub)}
    </ul>`;
  }

  private rings(data: Review): SafeHtml {
    const shown = data.rings.slice(0, RING_MAX);
    const n = Math.max(1, shown.length);
    const step = Math.min(18, 68 / n);
    const width = step * 0.72;
    const c = RING_BOX / 2;
    const circles = shown.map(({ habit, fulfilment }, i) => {
      const r = RING_OUTER - width / 2 - i * step;
      const len = 2 * Math.PI * r;
      const rate = fulfilment.rate ?? 0;
      const offset = len * (1 - rate);
      const tint = this.flowerOf(habit).tint;
      return `<circle class="ol-review__ring-track" cx="${c}" cy="${c}" r="${fix(r)}" stroke-width="${fix(width)}"/>`
        + `<circle class="ol-review__ring-arc${rate > 0 ? ' ol-review__ring-arc--on' : ''}" cx="${c}" cy="${c}" r="${fix(r)}" stroke="${tint}" stroke-width="${fix(width)}"`
        + ` stroke-dasharray="${fix(len)}" stroke-dashoffset="${fix(offset)}" data-len="${fix(len)}" transform="rotate(-90 ${c} ${c})"/>`;
    }).join('');
    const svg = raw(`<svg class="ol-review__rings-svg" viewBox="0 0 ${RING_BOX} ${RING_BOX}" width="${RING_BOX}" height="${RING_BOX}" aria-hidden="true" focusable="false">${circles}</svg>`);
    const legend = data.rings.map(({ habit, fulfilment }, i) => {
      const tint = this.flowerOf(habit).tint;
      const swatch = i < RING_MAX
        ? raw(`<svg class="ol-review__swatch" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="5" fill="${tint}"/></svg>`)
        : raw('<span class="ol-review__swatch ol-review__swatch--none" aria-hidden="true"></span>');
      const sub = fulfilment.target > 0 ? fmt(t.reviewRingDone, { n: fulfilment.done }) : t.reviewRingNoDue;
      return h`<li class="ol-review__legend-row">
        ${swatch}
        <span class="ol-review__legend-text"><span class="ol-review__legend-name">${habit.name}</span><span class="ol-caption">${sub}</span></span>
        <span class="ol-review__legend-pct ol-num">${pctText(fulfilment.rate)}</span>
      </li>`;
    });
    return h`<section class="ol-section ol-review__rings" aria-labelledby="review-rings">
      <div class="ol-section__head">
        <h2 class="ol-label" id="review-rings">${t.reviewSectionRings}</h2>
        <span class="ol-review__head-value ol-num">${pctText(data.rate)}</span>
      </div>
      <ol-card class="ol-review__card">
        <div class="ol-review__rings-body">
          <div class="ol-review__rings-figure">${svg}</div>
          <ol class="ol-review__legend" aria-label="${t.reviewRingsAria}">${legend}</ol>
        </div>
        <p class="ol-review__hint ol-caption">${t.reviewRingsHint}${data.rings.length > RING_MAX ? h` ${fmt(t.reviewRingsMore, { n: RING_MAX })}` : null}</p>
      </ol-card>
    </section>`;
  }

  private streaks(data: Review): SafeHtml {
    const max = Math.max(0, ...data.streaks.map((s) => s.span));
    const rows = data.streaks.map((s) => {
      const { flower, tint } = this.flowerOf(s.habit);
      const fill = max > 0 ? s.span / max : 0;
      const value = s.best > 0 ? streakText(s) : t.reviewStreakNone;
      return h`<li class="ol-review__streak">
        <span class="ol-review__streak-plant" aria-hidden="true">${raw(plant(s.stage, flower, tint, PLANT_SIZE))}</span>
        <span class="ol-review__streak-main">
          <span class="ol-review__streak-top">
            <span class="ol-review__streak-name">${s.habit.name}</span>
            <span class="ol-review__streak-value ol-num">${value}</span>
          </span>
          <span class="ol-review__bar" aria-hidden="true"><span class="ol-review__bar-fill" data-fill="${fix(fill)}"></span></span>
          <span class="ol-caption">${stageName(s.stage)}</span>
        </span>
      </li>`;
    });
    return h`<section class="ol-section ol-review__streaks-section" aria-labelledby="review-streaks">
      <div class="ol-section__head"><h2 class="ol-label" id="review-streaks">${t.reviewSectionStreaks}</h2></div>
      <ol-card class="ol-review__card"><ul class="ol-review__streaks">${rows}</ul></ol-card>
    </section>`;
  }

  /** Long weekday name of ISO weekday n (a day of that weekday near today). */
  private weekdayLong(n: number): string {
    return formatWeekdayLong(addDays(this.day, n - isoWeekday(this.day)));
  }

  private rhythm(rhythm: Rhythm): SafeHtml {
    const max = Math.max(0, ...rhythm.days.map((d) => d.average));
    const head = h`<div class="ol-section__head"><h2 class="ol-label" id="review-rhythm">${t.reviewSectionRhythm}</h2></div>`;
    if (rhythm.best === null) {
      return h`<section class="ol-section ol-review__rhythm-section" aria-labelledby="review-rhythm">${head}
        <ol-card class="ol-review__card"><p class="ol-body-s ol-text-2">${t.reviewRhythmEmpty}</p></ol-card></section>`;
    }
    const cols = rhythm.days.map((d) => {
      const best = d.weekday === rhythm.best;
      return h`<li class="ol-review__day"${best ? raw(' data-best') : null}>
        <span class="ol-review__day-value ol-caption ol-num">${num1.format(d.average)}</span>
        <span class="ol-review__day-track"><span class="ol-review__day-fill" data-fill="${fix(max > 0 ? d.average / max : 0)}"></span></span>
        <span class="ol-review__day-label ol-caption">${weekdayShort(d.weekday)}</span>
      </li>`;
    });
    const list = rhythm.days.map((d) => h`<li>${fmt(t.reviewRhythmValue, { day: this.weekdayLong(d.weekday), n: num1.format(d.average) })}${d.weekday === rhythm.best ? `, ${t.reviewRhythmBestMark}` : ''}</li>`);
    return h`<section class="ol-section ol-review__rhythm-section" aria-labelledby="review-rhythm">${head}
      <ol-card class="ol-review__card">
        <p class="ol-review__hint ol-caption">${t.reviewRhythmHint}</p>
        <ol class="ol-review__days" aria-hidden="true">${cols}</ol>
        <ul class="ol-visually-hidden">${list}</ul>
        <p class="ol-review__best ol-body-s">${raw(`<span class="ol-review__best-dot" aria-hidden="true"></span>`)}${fmt(t.reviewRhythmBest, { day: this.weekdayLong(rhythm.best) })}</p>
      </ol-card>
    </section>`;
  }

  private mood(mood: MoodTrend): SafeHtml {
    const head = h`<div class="ol-section__head"><h2 class="ol-label" id="review-mood">${t.reviewSectionMood}</h2></div>`;
    if (mood.count === 0) {
      return h`<section class="ol-section ol-review__mood-section" aria-labelledby="review-mood">${head}
        <ol-card class="ol-review__card"><p class="ol-body-s ol-text-2">${t.reviewMoodEmpty}</p></ol-card></section>`;
    }
    const n = mood.points.length;
    const x = (i: number): number => MOOD_LEFT + (n > 1 ? (i * (MOOD_W - MOOD_LEFT - MOOD_RIGHT)) / (n - 1) : (MOOD_W - MOOD_LEFT - MOOD_RIGHT) / 2);
    const y = (v: number): number => MOOD_TOP + (5 - v) * MOOD_STEP;
    let grid = '';
    for (let v = 1; v <= 5; v++) {
      grid += `<line class="ol-review__mood-grid" x1="${MOOD_LEFT}" x2="${MOOD_W - MOOD_RIGHT}" y1="${y(v)}" y2="${y(v)}"/>`
        + `<text class="ol-review__mood-axis" x="${MOOD_LEFT - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    }
    let path = '';
    let prev = false;
    mood.points.forEach((p, i) => {
      if (p.value === null) {
        prev = false;
        return;
      }
      path += `${prev ? 'L' : 'M'}${fix(x(i))} ${fix(y(p.value))}`;
      prev = true;
    });
    const dots = mood.points.map((p, i) => (p.value === null ? '' : `<circle class="ol-review__mood-dot" cx="${fix(x(i))}" cy="${fix(y(p.value))}" r="3.5"/>`)).join('');
    const avg = mood.average === null ? '' : `<line class="ol-review__mood-avg" x1="${MOOD_LEFT}" x2="${MOOD_W - MOOD_RIGHT}" y1="${fix(y(mood.average))}" y2="${fix(y(mood.average))}"/>`;
    const svg = raw(`<svg class="ol-review__mood-svg" viewBox="0 0 ${MOOD_W} ${MOOD_H}" aria-hidden="true" focusable="false">${grid}${avg}<path class="ol-review__mood-line" d="${path}"/>${dots}</svg>`);
    const first = mood.points[0]?.day ?? this.day;
    const last = mood.points[n - 1]?.day ?? this.day;
    return h`<section class="ol-section ol-review__mood-section" aria-labelledby="review-mood">${head}
      <ol-card class="ol-review__card">
        <figure class="ol-review__mood-figure">
          ${svg}
          <div class="ol-review__mood-dates ol-caption ol-num" aria-hidden="true"><span>${formatDayShort(first)}</span><span>${formatDayShort(last)}</span></div>
          <figcaption class="ol-review__mood-summary ol-body-s">${moodSummary(mood)}</figcaption>
        </figure>
        <p class="ol-review__hint ol-caption">${fmt(t.reviewMoodScale, { low: moodLabel(1), high: moodLabel(5) })}</p>
      </ol-card>
    </section>`;
  }

  // --- Final values and the opening animation ---

  private applyVars(): void {
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-fill]')) setVar(el, '--fill', el.dataset['fill'] ?? '0');
  }

  private animateIn(): void {
    const body = this.body;
    if (typeof body.animate !== 'function') return;
    for (const arc of body.querySelectorAll<SVGCircleElement>('.ol-review__ring-arc')) {
      const len = arc.dataset['len'] ?? arc.getAttribute('stroke-dasharray') ?? '0';
      const end = arc.getAttribute('stroke-dashoffset') ?? len;
      arc.animate([{ strokeDashoffset: len }, { strokeDashoffset: end }], { duration: RING_MS, easing: EASE });
    }
    for (const bar of body.querySelectorAll<HTMLElement>('.ol-review__bar-fill')) {
      bar.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${bar.dataset['fill'] ?? '0'})` }], { duration: BAR_MS, easing: EASE });
    }
    for (const bar of body.querySelectorAll<HTMLElement>('.ol-review__day-fill')) {
      bar.animate([{ transform: 'scaleY(0)' }, { transform: `scaleY(${bar.dataset['fill'] ?? '0'})` }], { duration: BAR_MS, easing: EASE });
    }
  }
}

/** Text equivalent of the mood chart: average, most frequent value and the trend of the halves. */
export function moodSummary(mood: MoodTrend): string {
  const days = mood.points.length;
  if (mood.count === 0 || mood.average === null) return t.reviewMoodEmpty;
  const parts: string[] = [];
  if (mood.count === 1 && mood.most !== null) {
    parts.push(fmt(t.reviewMoodSummaryOne, { days, label: moodLabel(mood.most) }));
  } else {
    parts.push(fmt(t.reviewMoodSummary, { avg: num1.format(mood.average), n: mood.count, days }));
    if (mood.most !== null) parts.push(fmt(t.reviewMoodMost, { label: moodLabel(mood.most) }));
  }
  if (mood.trend !== null && mood.firstHalf !== null && mood.secondHalf !== null) {
    const vars = { a: num1.format(mood.firstHalf), b: num1.format(mood.secondHalf) };
    parts.push(mood.trend === 'up' ? fmt(t.reviewMoodUp, vars) : mood.trend === 'down' ? fmt(t.reviewMoodDown, vars) : t.reviewMoodSteady);
  }
  return parts.join(' ');
}

