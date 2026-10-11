// CONTRACT STUB – implemented in AP4.
import type { ISO, Reminder, Task } from '../model.js';

/** Fire time of a reminder (relative: dueAt − offset; absolute: at); null if not computable. */
export function fireTime(task: Task, reminder: Reminder): ISO | null {
  throw new Error(`not implemented: fireTime ${task.id} ${reminder.id}`);
}

/**
 * Starts the scheduler (F §4.14): one setTimeout to the next due reminder
 * (max 2^31−1 ms, chained), recomputed on start, visibilitychange, focus and
 * whenever tasks change (tasksWithReminders$). Fires a toast with "Erledigt"
 * and "+1 h", plus new Notification() when permission is granted. Reminders
 * that became due while the page was closed are summarized in one toast.
 */
export function startReminders(): void {
  throw new Error('not implemented: startReminders');
}

/**
 * Before the first reminder is created: hint dialog "Erinnerungen werden nur
 * bei geöffneter Seite ausgelöst", then Notification.requestPermission() (only
 * when the permission is 'default'). Resolves when done; the caller saves the
 * reminder regardless of the outcome (D.5).
 */
export function ensureReminderPermission(): Promise<void> {
  throw new Error('not implemented: ensureReminderPermission');
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  throw new Error('not implemented: notificationPermission');
}
