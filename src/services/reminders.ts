// Reminder scheduler (F §4.14, B.4 "Benachrichtigungen", D.5). Reminders fire only while the
// page is open: one setTimeout to the next fire time (capped at 2^31−1 ms, re-armed when it
// expires), recomputed on every data change, visibilitychange and focus. A fired reminder is
// dismissed (dismissedAt) so it never fires twice; done tasks never remind.
// Several missed reminders give one toast whose action "Fällig heute" opens HEUTE and reveals that
// section (S13, D.5.3): it sets a short-lived flag (takeRevealDue) and emits `ol-reveal-due`.
import { confirmDialog } from '../components/ol-dialog.js';
import { showToast } from '../components/ol-toast.js';
import { db } from '../db.js';
import { fmt, t } from '../i18n/de.js';
import type { ISO, Reminder, Task } from '../model.js';
import { getArea } from '../repo/areas.js';
import { getProject } from '../repo/projects.js';
import {
  completeTask, dismissReminder, getTask, reopenTask, snoozeReminder, tasksWithReminders$,
} from '../repo/tasks.js';
import { formatDayShort, formatTime, now } from '../util/date.js';
import { emit } from '../util/dom.js';

const MAX_DELAY = 2 ** 31 - 1;
/** Reminders this late (e.g. after the device slept) count as missed and are bundled. */
const LATE_MS = 5 * 60_000;
/** Reminder toasts stay until the user acts (S12); the cap keeps a plain setTimeout valid. */
const STICKY_MS = MAX_DELAY;

/** Fire time of a reminder (relative: dueAt − offset; absolute: at); null if not computable. */
export function fireTime(task: Task, reminder: Reminder): ISO | null {
  let ms: number;
  if (reminder.mode === 'absolute') {
    if (!reminder.at) return null;
    ms = Date.parse(reminder.at);
  } else {
    // Relative reminders need a due time; date-only tasks have none (dueHasTime 0).
    if (!task.dueAt || task.dueHasTime !== 1 || typeof reminder.offsetMinutes !== 'number') return null;
    ms = Date.parse(task.dueAt) - reminder.offsetMinutes * 60_000;
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Scheduler

interface Due { task: Task; reminder: Reminder; at: number }

let started = false;
let loaded = false;
let startup = true;
let tasks: readonly Task[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
/** taskId:reminderId of reminders handled in this session (dismissal may still be pending). */
const handled = new Set<string>();

const keyOf = (task: Task, reminder: Reminder): string => `${task.id}:${reminder.id}`;

/** How long a "Fällig heute" request waits for HEUTE to mount and load. */
const REVEAL_WINDOW_MS = 10_000;
let revealDueAt: number | null = null;

/**
 * True once after the missed-reminders toast asked HEUTE to reveal "Fällig heute" (within a
 * short window); HEUTE calls it after its first complete render and on `ol-reveal-due`.
 */
export function takeRevealDue(): boolean {
  const at = revealDueAt;
  if (at === null) return false;
  revealDueAt = null;
  return performance.now() - at <= REVEAL_WINDOW_MS;
}

function revealDueToday(): void {
  revealDueAt = performance.now();
  navigateTo('/heute');
  emit(document, 'ol-reveal-due');
}

/**
 * Starts the scheduler (F §4.14): one setTimeout to the next due reminder
 * (max 2^31−1 ms, chained), recomputed on start, visibilitychange, focus and
 * whenever tasks change (tasksWithReminders$). Fires a toast with "Erledigt"
 * and "+1 h", plus new Notification() when permission is granted. Reminders
 * that became due while the page was closed are summarized in one toast.
 * Idempotent.
 */
export function startReminders(): void {
  if (started) return;
  started = true;
  try {
    tasksWithReminders$().subscribe({
      next: (list) => {
        tasks = list;
        loaded = true;
        check();
      },
      error: (err: unknown) => console.error(err),
    });
  } catch (err) {
    started = false;
    console.error(err);
    return;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
}

/** Fires every due reminder and arms the timer for the next one. */
function check(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (!loaded) return;
  const nowMs = now().getTime();
  const due: Due[] = [];
  const pending = new Set<string>();
  let next = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    if (task.status === 'done') continue;
    for (const reminder of task.reminders ?? []) {
      if (reminder.dismissedAt) continue;
      const key = keyOf(task, reminder);
      pending.add(key);
      if (handled.has(key)) continue;
      const iso = fireTime(task, reminder);
      if (iso === null) continue;
      const at = Date.parse(iso);
      if (at <= nowMs) due.push({ task, reminder, at });
      else next = Math.min(next, at);
    }
  }
  // Forget handled reminders once their dismissal (or removal) has arrived.
  for (const key of handled) if (!pending.has(key)) handled.delete(key);

  const atStartup = startup;
  startup = false;
  if (due.length > 0) deliver(due, atStartup, nowMs);
  if (next !== Number.POSITIVE_INFINITY) timer = setTimeout(check, Math.min(next - nowMs, MAX_DELAY));
}

function deliver(due: Due[], atStartup: boolean, nowMs: number): void {
  due.sort((a, b) => a.at - b.at);
  for (const d of due) handled.add(keyOf(d.task, d.reminder));
  // Due while the page was closed (or the device slept): one bundled toast for several.
  const missed = atStartup ? due : due.filter((d) => nowMs - d.at > LATE_MS);
  const onTime = atStartup ? [] : due.filter((d) => nowMs - d.at <= LATE_MS);
  if (missed.length > 1) {
    for (const d of missed) dismissReminder(d.task.id, d.reminder.id).catch((err: unknown) => console.error(err));
    showToast(fmt(t.toastRemindersMissed, { n: missed.length }), {
      actions: [{ label: t.sectionDueToday, onAction: revealDueToday }],
      duration: STICKY_MS,
    });
  } else {
    onTime.unshift(...missed);
  }
  for (const d of onTime) void fire(d.task, d.reminder);
}

async function fire(task: Task, reminder: Reminder): Promise<void> {
  // Another tab may already have shown (and dismissed) it.
  let current: Task | undefined = task;
  try {
    current = await getTask(task.id);
  } catch (err) {
    console.error(err);
  }
  const fresh = current?.reminders?.find((r) => r.id === reminder.id);
  if (!current || current.status === 'done' || !fresh || fresh.dismissedAt) return;
  try {
    await dismissReminder(current.id, reminder.id);
  } catch (err) {
    console.error(err);
  }
  const taskId = current.id;
  showToast(current.title, {
    actions: [
      { label: t.actionDone, onAction: () => void completeFromReminder(taskId) },
      { label: t.actionPlusHour, onAction: () => void snooze(taskId, reminder.id) },
    ],
    duration: STICKY_MS,
  });
  await notify(current);
}

async function completeFromReminder(taskId: string): Promise<void> {
  try {
    await completeTask(taskId);
    showToast(t.toastDone, { action: { label: t.actionUndo, onAction: () => void reopenTask(taskId).catch(failed) } });
  } catch (err) {
    failed(err);
  }
}

async function snooze(taskId: string, reminderId: string): Promise<void> {
  try {
    const added = await snoozeReminder(taskId, reminderId, 60);
    if (added.at) showToast(fmt(t.toastReminderSnoozed, { time: formatTime(added.at) }));
  } catch (err) {
    failed(err);
  }
}

function failed(err: unknown): void {
  console.error(err);
  showToast(t.toastError);
}

function navigateTo(path: string): void {
  emit(document, 'ol-navigate', { path });
}

// ---------------------------------------------------------------------------
// System notifications

function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** "Projekt/Bereich · Fälligkeit" (B.4); parts that are unknown are left out. */
async function notificationBody(task: Task): Promise<string | undefined> {
  let context: string | undefined;
  try {
    context = task.projectId ? (await getProject(task.projectId))?.name : undefined;
    context ??= (await getArea(task.areaId))?.name;
  } catch {
    context = undefined;
  }
  let due: string | undefined;
  if (task.dueDay) {
    const date = formatDayShort(task.dueDay);
    due = task.dueHasTime === 1 && task.dueAt ? fmt(t.notificationDue, { date, time: formatTime(task.dueAt) }) : date;
  }
  if (context && due) return fmt(t.notificationBody, { context, due });
  return context ?? due;
}

async function notify(task: Task): Promise<void> {
  if (notificationPermission() !== 'granted') return;
  const body = await notificationBody(task);
  try {
    const notification = new Notification(task.title, { body, tag: task.id });
    notification.onclick = () => {
      window.focus();
      navigateTo(`/aufgabe/${encodeURIComponent(task.id)}`);
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker; the toast suffices.
  }
}

/**
 * Before the first reminder is created: hint dialog "Erinnerungen werden nur
 * bei geöffneter Seite ausgelöst" (it mentions the browser prompt only when one
 * follows), then Notification.requestPermission() (only when the permission is 'default'). Resolves once the dialog is answered (the
 * permission prompt is not waited for); the caller saves the reminder regardless
 * of the outcome (D.5).
 */
export async function ensureReminderPermission(): Promise<void> {
  let first = false;
  try {
    first = (await db.tasks.filter((task) => (task.reminders ?? []).length > 0).first()) === undefined;
  } catch (err) {
    console.error(err);
  }
  if (!first) return;
  // The sentence about the browser prompt only when a prompt follows (permission 'default').
  const body = notificationPermission() === 'default' ? t.reminderHintBody : t.reminderHintClosed;
  const confirmed = await confirmDialog({ title: t.reminderHint, body, confirmLabel: t.actionNext });
  // Requested right after the confirm click (no await in between) so the user activation still counts.
  if (!confirmed || notificationPermission() !== 'default') return;
  try {
    // Not awaited: the reminder is saved at once, whatever the user answers and even while the
    // browser prompt is still open or ignored (D.5). Old Safari returns no promise.
    const request: unknown = Notification.requestPermission();
    if (request instanceof Promise) request.catch((err: unknown) => console.error(err));
  } catch (err) {
    console.error(err);
  }
}

/**
 * Settings › Benachrichtigungen (decision 2026-10-12): asks for the permission again while the
 * browser has not decided yet ('default'). Must be called directly from a click handler.
 */
export function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (notificationPermission() !== 'default') return Promise.resolve(notificationPermission());
  try {
    const request: unknown = Notification.requestPermission();
    if (request instanceof Promise) return request.then(() => notificationPermission(), () => notificationPermission());
  } catch (err) {
    console.error(err);
  }
  return Promise.resolve(notificationPermission());
}
