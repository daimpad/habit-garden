// Capture sheet (F §4.13, A.2 G1/G2, B.3 sheet layout): type chips Aufgabe/Gewohnheit/Notiz above a
// one-line title field that has focus at once; Save in the footer (thumb zone); Enter saves.
//
// Details of this implementation:
// - The sheet height follows its content (SheetOptions.fit, S27); history entry pushed (Back closes it).
// - The title field is focused synchronously inside open(), so iOS opens the keyboard from the FAB tap.
// - Task: first active area (or opts.areaId), no date, projectId null (D4). The task is reached in
//   Phase 1 through the focus picker's "Ohne Datum" group; the Inbox view is TODO(phase-3).
// - Habit: daily (interval 1), period 'any', startDay today, no area unless opts.areaId is given
//   (S17: generic flower); the toast offers "Bearbeiten" (habit editor).
// - Note: kind 'note' whose body is the title as well (D8); the notes list in WISSEN is TODO(phase-4).
// - Quick syntax (A.2 G2, services/quick-syntax): only for "Aufgabe". The title is parsed on every input;
//   recognised parts show as non-interactive chips below the field (aria-hidden) with a visually hidden
//   aria-live="polite" summary, so it is clear what will be saved. "@" resolves active projects first,
//   then areas (Phase 3, repo/projects projectResolver); a project shows its name as the chip. The
//   helper text lists the syntax until something is recognised (then the chips take its place); habits
//   and notes save the text as typed.
// - Saving a task parses again with the current day, areas and projects: title = parsed title (the raw
//   text when nothing else is left), flags, project + its area / area / the default (a project given by
//   the caller stays only while the area is its own), tags (ensureTags first), dueAt via isoAt.
import '../../components/ol-button.js';
import '../../components/ol-chip.js';
import '../../components/ol-input.js';
import type { OlButton } from '../../components/ol-button.js';
import type { ChipChange } from '../../components/ol-chip.js';
import type { OlInput } from '../../components/ol-input.js';
import { createSheet, type OlSheet } from '../../components/ol-sheet.js';
import { showToast } from '../../components/ol-toast.js';
import { fmt, t } from '../../i18n/de.js';
import type { Area, Day, Id, Project } from '../../model.js';
import { firstActiveArea, listAreas } from '../../repo/areas.js';
import { createHabit } from '../../repo/habits.js';
import { createNote } from '../../repo/notes.js';
import { getProject, listProjects, projectResolver } from '../../repo/projects.js';
import { ensureTags } from '../../repo/tags.js';
import { createTask } from '../../repo/tasks.js';
import {
  parseQuickSyntax, QUICK_IMPORTANT, QUICK_TAG, QUICK_URGENT, type QuickParse,
} from '../../services/quick-syntax.js';
import { addDays, formatDayShort, formatWeekdayShort, isoAt, today } from '../../util/date.js';
import { h, icon, render } from '../../util/dom.js';
import { openHabitEditor } from './habit.js';
import { failed } from './task.js';

export type CaptureType = 'task' | 'habit' | 'note';
export interface CaptureOptions { type?: CaptureType; areaId?: Id; projectId?: Id | null }

const TYPES: ReadonlyArray<{ type: CaptureType; label: string; icon: string }> = [
  { type: 'task', label: t.captureTypeTask, icon: 'circle-check' },
  { type: 'habit', label: t.captureTypeHabit, icon: 'sprout' },
  { type: 'note', label: t.captureTypeNote, icon: 'notebook-pen' },
];

function isCaptureType(value: unknown): value is CaptureType {
  return value === 'task' || value === 'habit' || value === 'note';
}

async function defaultAreaId(areaId: Id | undefined): Promise<Id | undefined> {
  return areaId ?? (await firstActiveArea())?.id;
}

const QUICK_HINT = fmt(t.captureQuickHintProjects, { important: QUICK_IMPORTANT, urgent: QUICK_URGENT });

/** Parses with "@" looking up active projects first, then areas. */
function parseTask(text: string, base: Day, areas: readonly Area[], projects: readonly Project[]): QuickParse {
  return parseQuickSyntax(text, { today: base, areas, resolveAt: projectResolver(projects, areas) });
}

/** "Heute" / "Morgen" / "Übermorgen" / "Fr, 16.10.", with ", 14:00" when timed. */
function dueLabel(day: Day, time: string | undefined, base: Day): string {
  const date = day === base ? t.captureQuickToday
    : day === addDays(base, 1) ? t.captureQuickTomorrow
      : day === addDays(base, 2) ? t.captureQuickDayAfter
        : fmt(t.captureQuickWeekdayDate, { weekday: formatWeekdayShort(day), date: formatDayShort(day) });
  return time ? fmt(t.captureQuickDayTime, { date, time }) : date;
}

interface QuickItem { icon: string; label: string; spoken: string }

/** The recognised parts in a fixed order: flags, project or area, due, tags. */
function quickItems(quick: QuickParse, areas: readonly Area[], projects: readonly Project[], base: Day): QuickItem[] {
  const items: QuickItem[] = [];
  if (quick.important) items.push({ icon: 'flag', label: t.flagImportant, spoken: t.flagImportant });
  if (quick.urgent) items.push({ icon: 'alarm-clock', label: t.flagUrgent, spoken: t.flagUrgent });
  const project = quick.target?.kind === 'project' ? projects.find((p) => p.id === quick.target?.id) : undefined;
  const area = quick.areaId ? areas.find((a) => a.id === quick.areaId) : undefined;
  if (project) items.push({ icon: 'folder', label: project.name, spoken: fmt(t.captureQuickProjectSpoken, { name: project.name }) });
  else if (area) items.push({ icon: 'sprout', label: area.name, spoken: area.name });
  if (quick.dueDay) {
    const label = dueLabel(quick.dueDay, quick.time, base);
    items.push({ icon: 'calendar', label, spoken: label });
  }
  for (const path of quick.tagPaths) items.push({ icon: 'hash', label: path, spoken: `${QUICK_TAG}${path}` });
  return items;
}

export function openCapture(opts: CaptureOptions = {}): OlSheet {
  let type: CaptureType = opts.type ?? 'task';
  let saving = false;
  const sheet = createSheet({ title: t.captureTitle, fit: true });
  render(
    sheet.bodyEl,
    h`<div class="ol-capture">
  <div class="ol-capture__types" role="radiogroup" aria-label="${t.captureTypeAria}">
    ${TYPES.map((o) => h`<ol-chip kind="radio" value="${o.type}" icon="${o.icon}" label="${o.label}" ${o.type === type ? 'selected' : ''}></ol-chip>`)}
  </div>
  <ol-input class="ol-capture__title" label="${t.captureFieldTitle}" autocomplete="off" autofocus></ol-input>
  <ul class="ol-capture__parsed" aria-hidden="true" hidden></ul>
  <p class="ol-capture__summary ol-visually-hidden" aria-live="polite"></p>
</div>`,
  );
  render(sheet.footerEl, h`<ol-button class="ol-capture__save" variant="filled" label="${t.actionSave}"></ol-button>`);

  const input = sheet.bodyEl.querySelector<OlInput>('.ol-capture__title');
  const types = sheet.bodyEl.querySelector<HTMLElement>('.ol-capture__types');
  const button = sheet.footerEl.querySelector<OlButton>('.ol-capture__save');
  const parsed = sheet.bodyEl.querySelector<HTMLElement>('.ol-capture__parsed');
  const summary = sheet.bodyEl.querySelector<HTMLElement>('.ol-capture__summary');
  if (!input || !types || !button || !parsed || !summary) throw new Error('capture: markup missing');
  input.field?.setAttribute('enterkeyhint', 'done');

  // Active areas and projects for "@"; loaded once, the save path reads them again.
  let areas: Area[] = [];
  let projects: Project[] = [];
  let shownKey = '';
  const updateQuick = (): void => {
    const isTask = type === 'task';
    const base = today();
    const items = isTask ? quickItems(parseTask(input.value, base, areas, projects), areas, projects, base) : [];
    // The hint gives way to the chips: the fit sheet is at most half the screen high (S27).
    if (isTask && items.length === 0) input.setAttribute('helper', QUICK_HINT);
    else input.removeAttribute('helper');
    const key = items.map((item) => `${item.icon}:${item.label}`).join('|');
    if (key === shownKey) return;
    shownKey = key;
    render(parsed, h`${items.map((item) => h`<li class="ol-capture__parsed-item">${icon(item.icon, 20)}<span class="ol-capture__parsed-label">${item.label}</span></li>`)}`);
    parsed.hidden = items.length === 0;
    summary.textContent = items.length ? fmt(t.captureQuickSummary, { items: items.map((item) => item.spoken).join(', ') }) : '';
  };
  void Promise.all([listAreas(), listProjects()]).then(([areaList, projectList]) => {
    areas = areaList;
    projects = projectList;
    updateQuick();
  }, failed);

  const save = async (): Promise<void> => {
    if (saving) return;
    const title = input.value.trim();
    if (!title) {
      input.setAttribute('error', t.captureTitleRequired);
      input.focusInput();
      return;
    }
    saving = true;
    button.setAttribute('loading', '');
    try {
      if (type === 'task') {
        const [areaList, projectList] = await Promise.all([listAreas(), listProjects()]);
        const quick = parseTask(title, today(), areaList, projectList);
        const named = quick.target?.kind === 'project' ? projectList.find((p) => p.id === quick.target?.id) : undefined;
        // A project given by the caller belongs to its area (looked up when the caller gave no area).
        const given = opts.projectId ? await getProject(opts.projectId) : undefined;
        const areaId = named?.areaId ?? quick.areaId ?? (await defaultAreaId(opts.areaId ?? given?.areaId));
        if (!areaId) throw new Error('capture: no active area');
        // "@project" sets the project; "@area" naming another area than the given project's drops it.
        const projectId = named?.id ?? (given && given.areaId === areaId ? given.id : null);
        if (quick.tagPaths.length > 0) await ensureTags(quick.tagPaths);
        await createTask({
          title: quick.title || title,
          areaId,
          projectId,
          important: quick.important,
          urgent: quick.urgent,
          ...(quick.tagPaths.length > 0 ? { tagPaths: quick.tagPaths } : {}),
          ...(quick.dueDay ? { dueAt: isoAt(quick.dueDay, quick.time), dueHasTime: quick.time ? 1 : 0 } : {}),
        });
        sheet.close('action');
        showToast(t.toastTaskCreated);
      } else if (type === 'habit') {
        const habit = await createHabit({
          name: title, schedule: { kind: 'daily', interval: 1 }, period: 'any', ...(opts.areaId ? { areaId: opts.areaId } : {}),
        });
        sheet.close('action');
        showToast(t.toastHabitCreated, { action: { label: t.actionEdit, onAction: () => void openHabitEditor(habit.id) } });
      } else {
        await createNote({ title, body: title });
        sheet.close('action');
        showToast(t.toastNoteCreated);
      }
    } catch (err) {
      saving = false;
      button.removeAttribute('loading');
      failed(err);
    }
  };

  types.addEventListener('ol-change', (event) => {
    const detail = event instanceof CustomEvent ? (event.detail as ChipChange) : null;
    if (detail?.selected && isCaptureType(detail.value)) type = detail.value;
    updateQuick();
  });
  input.addEventListener('input', () => {
    if (input.value.trim() !== '') input.removeAttribute('error');
    updateQuick();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return;
    event.preventDefault();
    void save();
  });
  button.addEventListener('click', () => void save());

  updateQuick();
  sheet.open();
  // Safety net when no [autofocus] target was focusable at open time.
  if (!input.contains(document.activeElement)) input.focusInput();
  return sheet;
}
