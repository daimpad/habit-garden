export type Id = string; export type Day = string; export type ISO = string; export type SortKey = string;
export type FlowerId = 'bellis'|'calendula'|'helianthus'|'centaurea'|'passiflora'|'matricaria'|'leucanthemum'|'generic';

export interface Profile {
  key: 'profile'; schemaVersion: number;
  settings: { theme: 'light'|'dark'|'system'; dayStartHour: number; eveningHour: number; leftHanded: boolean;
              reminderLeadMinutes: number; animations: 'system'|'reduced'; landscape: 0|1; };
  onboardingDone: 0|1; createdAt: ISO; lastExportAt?: ISO; backupCardDismissedAt?: ISO;
  /** Approved addition (Rückfrage 2): ids of dismissed "Erste Schritte" cards. */
  firstStepsDismissed?: FirstStepId[];
  /** Phase 2 (H7): the day whose evening card "Morgen vorbereiten" was dismissed. */
  eveningCardDismissedFor?: Day;
  /** Phase 3 (P1/P2): PLANUNG tab state — selected area (absent = "Alle") and the view per area key. */
  planning?: PlanningState;
}
export type PlanningView = 'projects'|'list'|'kanban'|'matrix';
export interface PlanningState { areaId?: Id; views?: Record<string, PlanningView>; }
export type FirstStepId = 'focus'|'habit'|'note';
export interface Area { id: Id; name: string; flower: FlowerId; tint: string; sortKey: SortKey; archived: 0|1; updatedAt: ISO; }
export interface Project { id: Id; areaId: Id; name: string; description?: string; status: 'active'|'archived'; sortKey: SortKey; dueAt?: ISO; kanbanColumns?: string[]; updatedAt: ISO; }
export type Recurrence =
  | { kind: 'daily'; interval: number }
  | { kind: 'weekly'; interval: number; weekdays: number[] }   // weekdays: 1=Mo … 7=So (ISO, C.3)
  | { kind: 'monthly'; interval: number; day: number|'last' }
  | { kind: 'timesPerWeek'; times: number }
  | { kind: 'afterCompletion'; days: number };
export interface Reminder { id: Id; mode: 'absolute'|'relative'; at?: ISO; offsetMinutes?: number; dismissedAt?: ISO; }
export interface Task {
  id: Id; areaId: Id; projectId: Id|null; parentId: Id|null; title: string; description?: string;
  status: 'open'|'doing'|'done'; important: 0|1; urgent: 0|1;
  dueAt?: ISO; dueDay?: Day; dueHasTime: 0|1; completedAt?: ISO; recurrence?: Recurrence; recurrenceAnchor?: Day;
  reminders: Reminder[]; tagPaths?: string[]; linkedNoteIds?: Id[]; sortKey: SortKey; createdAt: ISO; updatedAt: ISO;
  followUpId?: Id;
}
export type HabitSchedule = Extract<Recurrence, { kind: 'daily'|'weekly'|'timesPerWeek' }>;
export interface Habit {
  id: Id; name: string; areaId?: Id;
  schedule: HabitSchedule;
  period: 'morning'|'evening'|'any'; target?: { value: number; unit: string };
  startDay: Day; archived: 0|1; sortKey: SortKey; updatedAt: ISO;
}
export interface HabitLog { id: `${Id}:${Day}`; habitId: Id; day: Day; status: 'done'|'skipped'; value?: number; loggedAt: ISO; }
export interface Note { id: Id; kind: 'note'|'journal'; journalDay?: Day; title: string; body: string; tagPaths: string[]; pinned: 0|1; archived: 0|1; linkedTaskIds?: Id[]; createdAt: ISO; updatedAt: ISO; }
export interface Tag { path: string; parentPath: string|null; name: string; color?: string; }
export interface MoodLog { id: Id; day: Day; value: 1|2|3|4|5; loggedAt: ISO; noteId?: Id; }
export interface DayPlan { id: Day; mitTaskIds: Id[]; preparedAt?: ISO; }

// People ("Personen"): someone to stay in touch with, at a desired rhythm in days.
export type ContactKind = 'call'|'message'|'meeting';
export interface Contact { id: Id; name: string; rhythmDays: number; note?: string; archived: 0|1; sortKey: SortKey; createdAt: ISO; updatedAt: ISO; }
/** One log per person and day: id = `${contactId}:${day}`. */
export interface ContactLog { id: `${Id}:${Day}`; contactId: Id; day: Day; kind?: ContactKind; loggedAt: ISO; }
/** Contact rhythms in days: weekly, every two weeks, monthly, quarterly. */
export const CONTACT_RHYTHMS: readonly number[] = [7, 14, 30, 90];
export const DEFAULT_CONTACT_RHYTHM = 14;

export type Stage = 0|1|2|3|4;

export const DEFAULT_AREAS: ReadonlyArray<Pick<Area,'flower'|'name'|'tint'>> = [
  { flower: 'bellis',       name: 'Gesundheit & Fitness',    tint: '#7FA36F' },
  { flower: 'calendula',    name: 'Finanzen & Wohlstand',    tint: '#D8B24A' },
  { flower: 'helianthus',   name: 'Beziehungen',             tint: '#C96A5A' },
  { flower: 'centaurea',    name: 'Beruf & Karriere',        tint: '#5B7FB5' },
  { flower: 'passiflora',   name: 'Persönliche Entwicklung', tint: '#8C6FB0' },
  { flower: 'matricaria',   name: 'Freizeit & Erholung',     tint: '#E0925A' },
  { flower: 'leucanthemum', name: 'Wohnen & Alltag',         tint: '#9AA39C' },
];

/** Custom area ("Eigener Bereich", C.3): generic flower in sage. */
export const GENERIC_TINT = '#9CB59A';

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Profile['settings'] = {
  theme: 'light', dayStartHour: 5, eveningHour: 17, leftHanded: false,
  reminderLeadMinutes: 10, animations: 'system', landscape: 0,
};

export const MAX_FOCUS = 3;
