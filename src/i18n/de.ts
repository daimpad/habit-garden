// All user-facing texts (German). No strings in component code.
// Rules (B.4): full sentences, no exclamation marks, numbers instead of praise.
// Placeholders: {name}; fill with fmt().

import type { FlowerId, Stage } from '../model.js';

export const t = {
  appName: 'Olife',

  // Navigation
  navLabel: 'Hauptnavigation',
  tabHeute: 'Heute',
  tabPlanung: 'Planung',
  tabWissen: 'Wissen',
  titlePlanung: 'Planung',
  titleWissen: 'Wissen',

  // Common actions
  actionFocusPick: 'Fokus wählen',
  actionCreate: 'Neu anlegen',
  actionDone: 'Erledigt',
  actionUndo: 'Rückgängig',
  actionSave: 'Speichern',
  actionCancel: 'Abbrechen',
  actionDelete: 'Löschen',
  actionConfirmDelete: 'Wirklich löschen?',
  actionBack: 'Zurück',
  actionClose: 'Schließen',
  actionSettings: 'Einstellungen',
  actionMore: 'Weitere Aktionen',
  actionEdit: 'Bearbeiten',
  actionArchive: 'Archivieren',
  actionUnarchive: 'Reaktivieren',
  actionRename: 'Umbenennen',
  actionNext: 'Weiter',
  actionSkip: 'Überspringen',
  actionFinish: 'Fertig',
  actionDismiss: 'Ausblenden',
  actionShowMore: 'Mehr anzeigen',
  actionShowLess: 'Weniger anzeigen',
  actionExpandList: 'Alle anzeigen',
  actionCollapseList: 'Weniger anzeigen',
  actionAddToFocus: 'In den Fokus',
  actionRemoveFromFocus: 'Aus dem Fokus nehmen',
  actionPlusHour: '+1 h',
  actionOpen: 'Öffnen',
  actionAddNote: '+ Notiz',
  actionCreateHabit: 'Routine anlegen',

  // HEUTE sections
  sectionFocus: 'Fokus',
  sectionRoutinesMorning: 'Routinen · Morgen',
  sectionRoutinesEvening: 'Routinen · Abend',
  sectionRoutines: 'Routinen',
  sectionMood: 'Stimmung',
  sectionDueToday: 'Fällig heute',
  sectionFirstSteps: 'Erste Schritte',

  // Empty states
  emptyFocus: 'Wähle bis zu 3 Aufgaben, die heute zählen',
  emptyRoutines: 'Noch keine Routine',
  emptyWissen: 'Erste Notiz anlegen – Markdown, Tags wie #bereich/thema',
  emptyPlanung: 'Neue Aufgaben legst du mit + an; mit Datum erscheinen sie in Heute unter „Fällig heute“.',
  emptyFocusPick: 'Keine passenden offenen Aufgaben',

  // Growth stages
  stage0: 'Samen',
  stage1: 'Spross',
  stage2: 'Blätter',
  stage3: 'Knospe',
  stage4: 'Blüte',

  // Toast templates
  toastStageReached: '{name}: Stufe {stage} erreicht',
  toastDone: 'Erledigt',
  toastDayDone: '{date}: als erledigt markiert',
  toastDayReset: '{date}: zurückgesetzt',
  toastSaved: 'Gespeichert',
  toastTaskCreated: 'Aufgabe angelegt',
  toastHabitCreated: 'Routine angelegt',
  toastNoteCreated: 'Notiz gespeichert',
  toastJournalSaved: 'Journal gespeichert',
  toastDeleted: 'Gelöscht',
  toastHabitArchived: 'Routine archiviert',
  toastFocusAdded: 'In den Fokus übernommen',
  toastFocusRemoved: 'Aus dem Fokus genommen',
  toastFocusFull: 'Der Fokus umfasst höchstens drei Aufgaben.',
  toastExported: 'Export gespeichert',
  toastImportMerged: 'Import: {created} neu, {updated} aktualisiert',
  toastImportRestored: 'Wiederhergestellt: {n} Datensätze',
  toastImportInvalid: 'Die Datei ist kein gültiger Olife-Export.',
  toastImportFailed: 'Der Import ist fehlgeschlagen; die bisherigen Daten sind unverändert.',
  toastRemindersMissed: '{n} verpasste Erinnerungen',
  toastRemindersMissedOne: '1 verpasste Erinnerung',
  toastReminderSnoozed: 'Erinnerung um {time}',
  toastError: 'Die Änderung konnte nicht gespeichert werden.',

  // Focus
  focusProgressAria: '{done} von {n} Fokus-Aufgaben erledigt',
  focusPickTitle: 'Fokus wählen',
  focusGroupOverdue: 'Überfällig',
  focusGroupDueToday: 'Heute fällig',
  focusGroupNoDate: 'Ohne Datum',
  focusSearchLabel: 'Aufgaben durchsuchen',
  focusLimitHint: 'Der Fokus umfasst höchstens drei Aufgaben.',
  focusSlotEmpty: 'Fokus wählen',
  focusRowAria: '{title}, Bereich {area}',

  // Routines / habits
  habitStreakAria: 'Streak {n}',
  habitBestStreak: 'Bester Streak',
  habitStreak: 'Streak',
  habitRhythm: 'Rhythmus',
  habitPlantAria: 'Stufe {stage}, Streak {n}',
  habitToggleAria: '{name}: heute erledigt',
  habitWeekProgress: '{done}/{target}',
  habitWeekProgressAria: '{done} von {target} in dieser Woche',
  habitOpenAria: '{name}: Details öffnen',
  habitEditTitle: 'Routine bearbeiten',
  habitSheetTitle: 'Routine',
  confirmDeleteHabit: 'Die Routine und alle ihre Einträge werden gelöscht.',
  rhythmDaily: 'Täglich',
  rhythmEveryNDays: 'Alle {n} Tage',
  rhythmWeekly: 'Wöchentlich: {days}',
  rhythmEveryNWeeks: 'Alle {n} Wochen: {days}',
  rhythmTimesPerWeek: '{n}× pro Woche',
  rhythmKindDaily: 'Täglich',
  rhythmKindWeekly: 'Wochentage',
  rhythmKindTimesPerWeek: 'x-mal pro Woche',
  periodMorning: 'Morgen',
  periodEvening: 'Abend',
  periodAny: 'Jederzeit',

  // Heatmap
  heatmapAria: '{name}: letzte 12 Wochen. Erfüllt an {n} von {m} Tagen. Pfeiltasten bewegen, Enter schaltet.',
  heatmapTooltip: '{date}: {status}',
  heatmapTooltipStage: '{date}: {status} · Stufe {stage}',
  heatmapStatusDone: 'erledigt',
  heatmapStatusSkipped: 'übersprungen',
  heatmapStatusOpen: 'nicht erledigt',
  heatmapStatusFuture: 'noch nicht erreicht',

  // Weekdays (ISO order, Monday first)
  weekdayShort1: 'Mo', weekdayShort2: 'Di', weekdayShort3: 'Mi', weekdayShort4: 'Do',
  weekdayShort5: 'Fr', weekdayShort6: 'Sa', weekdayShort7: 'So',

  // Mood
  moodGroupAria: 'Stimmung heute',
  mood1: 'Sehr schlecht',
  mood2: 'Schlecht',
  mood3: 'Ausgeglichen',
  mood4: 'Gut',
  mood5: 'Sehr gut',
  moodSavedAt: 'Gespeichert {time}',

  // Journal
  journalSheetTitle: 'Journal',
  journalFieldLabel: 'Notiz zum Tag (Markdown)',
  journalNoteTitle: 'Journal {date}',

  // Capture
  captureTitle: 'Neu anlegen',
  captureTypeAria: 'Art des Eintrags',
  captureTypeTask: 'Aufgabe',
  captureTypeHabit: 'Gewohnheit',
  captureTypeNote: 'Notiz',
  captureFieldTitle: 'Titel',
  captureTitleRequired: 'Bitte einen Titel eingeben.',

  // Task sheet
  taskSheetTitle: 'Aufgabe',
  taskTitleLabel: 'Titel',
  taskCheckAria: 'Als erledigt markieren',
  fieldDueDate: 'Fällig am',
  fieldDueTime: 'Uhrzeit',
  flagImportant: 'Wichtig',
  flagUrgent: 'Dringend',
  fieldArea: 'Bereich',
  fieldProject: 'Projekt',
  noProject: 'Kein Projekt',
  fieldDescription: 'Beschreibung',
  sectionSubtasks: 'Subtasks',
  subtasksPlaceholder: 'Noch keine Subtasks',
  sectionReminders: 'Erinnerungen',
  reminderAdd: 'Erinnerung hinzufügen',
  reminderRelative: '{n} min vor Fälligkeit',
  reminderAbsolute: '{date}, {time}',
  reminderRemoveAria: 'Erinnerung entfernen',
  reminderNeedsDue: 'Für eine Erinnerung vor Fälligkeit braucht die Aufgabe ein Datum mit Uhrzeit.',
  reminderModeRelative: 'Vor Fälligkeit',
  reminderModeAbsolute: 'Zeitpunkt',
  reminderOffsetLabel: 'Minuten vorher',
  reminderAtLabel: 'Datum und Uhrzeit',
  reminderHintTitle: 'Erinnerungen',
  reminderHint: 'Erinnerungen werden nur bei geöffneter Seite ausgelöst',
  reminderHintBody: 'Ist die Seite geschlossen, erscheinen fällige Erinnerungen gesammelt beim nächsten Öffnen. Anschließend fragt der Browser, ob Olife Systembenachrichtigungen zeigen darf.',
  confirmDeleteTask: 'Die Aufgabe wird gelöscht.',
  overdueLabel: 'Überfällig',
  dueTodayLabel: 'Heute',
  noArea: 'Ohne Bereich',
  fieldName: 'Name',
  fieldRhythm: 'Rhythmus',
  fieldPeriod: 'Tageszeit',
  fieldTimesPerWeek: 'Mal pro Woche',
  fieldWeekdays: 'Wochentage',
  fieldInterval: 'Alle wie viele Tage',

  // Onboarding
  onbStepAria: 'Schritt {n} von 3',
  onb1Title: 'So arbeitet Olife',
  onb1Line1: 'Deine Daten bleiben in diesem Browser.',
  onb1Line2: 'Es gibt kein Konto und keine Anmeldung.',
  onb1Line3: 'Du kannst alles jederzeit exportieren.',
  hintDeviceProtection: 'Daten bleiben in diesem Browser. Der Schutz der Daten entspricht dem Schutz des Geräts.',
  onb2Title: 'Bereiche wählen',
  onb2Intro: 'Wähle die Lebensbereiche, die du ordnen möchtest. Namen lassen sich später ändern.',
  onbCustomArea: 'Eigener Bereich',
  onbCustomAreaName: 'Name des Bereichs',
  onbCustomAreaDesc: 'Ein Bereich mit eigenem Namen',
  onbAreaRequired: 'Wähle mindestens einen Bereich.',
  onb3Title: 'Speicher sichern',
  onb3Intro: 'Olife bittet den Browser, die Daten dauerhaft zu speichern.',
  persistPending: 'Die Anfrage läuft.',
  persistGranted: 'Der Browser speichert die Daten dauerhaft.',
  persistDenied: 'Der Browser darf die Daten bei Speichermangel löschen. Regelmäßige Exporte schützen davor.',
  persistUnsupported: 'Dieser Browser meldet keinen Speicherstatus.',
  exportHint: 'Exportiere deine Daten regelmäßig über Einstellungen › Daten.',
  safariHint: 'Safari löscht Website-Daten, wenn die Seite sieben Tage nicht geöffnet wurde. Exportiere deine Daten deshalb regelmäßig.',

  // Area descriptions (onboarding)
  areaDescBellis: 'Körper, Bewegung, Schlaf',
  areaDescCalendula: 'Geld, Vorsorge, Verträge',
  areaDescHelianthus: 'Familie, Freunde, Partnerschaft',
  areaDescCentaurea: 'Arbeit, Projekte, Laufbahn',
  areaDescPassiflora: 'Lernen, Lesen, Reflexion',
  areaDescMatricaria: 'Hobbys, Erholung, Reisen',
  areaDescLeucanthemum: 'Haushalt, Umfeld, Alltag',

  // Flower names
  flowerBellis: 'Gänseblümchen',
  flowerCalendula: 'Ringelblume',
  flowerHelianthus: 'Sonnenblume',
  flowerCentaurea: 'Kornblume',
  flowerPassiflora: 'Passionsblume',
  flowerMatricaria: 'Kamille',
  flowerLeucanthemum: 'Margerite',
  flowerGeneric: 'Wiesenblume',

  // First steps (HEUTE)
  firstStepFocus: 'Fokus wählen: bis zu drei Aufgaben für heute',
  firstStepHabit: 'Routine anlegen: eine Gewohnheit, die wachsen soll',
  firstStepNote: 'Notiz schreiben: einen Gedanken festhalten',
  firstStepDismissAria: 'Karte ausblenden',

  // Backup card
  backupCardTitle: 'Daten sichern',
  backupCardBodyDays: 'Der letzte Export liegt {n} Tage zurück.',
  backupCardBodyNever: 'Es gibt noch keinen Export dieser Daten.',
  backupCardAction: 'Jetzt exportieren',

  // Settings
  settingsTitle: 'Einstellungen',
  settingsData: 'Daten',
  settingsNotifications: 'Benachrichtigungen',
  settingsAppearance: 'Darstellung',
  settingsAreas: 'Bereiche',
  settingsInfo: 'Info',
  exportJson: 'JSON exportieren',
  exportPlaintextHint: 'Die Exportdatei ist unverschlüsselt. Bewahre sie so sorgfältig auf wie das Gerät.',
  importJson: 'JSON importieren',
  importModeTitle: 'Daten importieren',
  importModeBody: 'Wie sollen die Daten aus der Datei übernommen werden?',
  importMerge: 'Zusammenführen',
  importRestore: 'Wiederherstellen',
  importMergeHint: 'Neuere Einträge aus der Datei ersetzen ältere; alles andere bleibt erhalten.',
  importRestoreHint: 'Alle aktuellen Daten werden gelöscht und durch die Datei ersetzt.',
  confirmRestoreTitle: 'Alle aktuellen Daten ersetzen?',
  confirmRestoreBody: 'Alle Aufgaben, Routinen, Notizen und Einstellungen in diesem Browser werden durch den Inhalt der Datei ersetzt.',
  storageUsage: 'Belegt: {used} von {quota}',
  storageUnknown: 'Der Speicherplatz ist nicht bekannt.',
  persistStatus: 'Dauerhafte Speicherung',
  persistOn: 'aktiv',
  persistOff: 'nicht aktiv',
  deleteAll: 'Alle Daten löschen',
  deleteAllTitle1: 'Alle Daten löschen?',
  deleteAllBody1: 'Alle Aufgaben, Routinen, Notizen und Einstellungen werden aus diesem Browser entfernt.',
  deleteAllTitle2: 'Endgültig löschen?',
  deleteAllBody2: 'Dieser Schritt lässt sich nicht rückgängig machen. Ohne Export sind die Daten verloren.',
  incognitoHint: 'Im privaten Modus löscht der Browser die Daten beim Schließen des Fensters.',
  theme: 'Thema',
  themeLight: 'Hell',
  themeSystem: 'System',
  leftHanded: 'Linkshänder-Modus',
  leftHandedHint: 'Die Schaltfläche zum Anlegen liegt links.',
  animations: 'Animationen',
  animationsSystem: 'System',
  animationsReduced: 'Reduziert',
  dayStartHour: 'Morgen beginnt um',
  eveningHour: 'Abend beginnt um',
  hourValue: '{h} Uhr',
  areaAdd: 'Bereich anlegen',
  areaFlower: 'Blume',
  areaArchived: 'archiviert',
  areaNameRequired: 'Bitte einen Namen eingeben.',
  notifPermission: 'Berechtigung für Systembenachrichtigungen',
  notifGranted: 'erteilt',
  notifDenied: 'abgelehnt',
  notifDefault: 'noch nicht angefragt',
  notifUnsupported: 'in diesem Browser nicht verfügbar',
  reminderLead: 'Standardvorlauf',
  minutesValue: '{n} min',
  infoVersion: 'Version',
  infoBuild: 'Build',
  infoLicenses: 'Lizenzen',
  infoPrivacy: 'Datenschutz',
  infoPrivacyText: 'Olife sendet keine Daten an einen Server. Alle Einträge bleiben in diesem Browser.',
  licenseDexie: 'Dexie – Apache License 2.0',
  licenseMarkdownIt: 'markdown-it – MIT License (gebündelt mit entities, linkify-it, mdurl, punycode.js, uc.micro)',
  licenseDompurify: 'DOMPurify – Mozilla Public License 2.0 oder Apache License 2.0',
  licenseInter: 'Inter – SIL Open Font License 1.1',
  licenseLucide: 'Lucide – ISC License',
  licenseOlife: 'Olife – Apache License 2.0',

  // Errors
  errorStorage: 'Der Browser stellt keinen Speicher bereit. Olife kann ohne IndexedDB nicht arbeiten.',
  errorBlocked: 'Olife ist in einem anderen Tab mit einer neueren Version geöffnet. Bitte lade diese Seite neu.',

  // Notifications
  notificationBody: '{context} · {due}',

  // Agents add keys only directly below their own marker line.
  // --- additions: logic ---
  notificationDue: '{date}, {time}',
  // --- additions: data ---
  // --- additions: garden ---
  // --- additions: habit-ui ---
  heatmapAriaWeeks: '{name}: letzte {weeks} Wochen. Erfüllt an {n} von {m} Tagen. Pfeiltasten bewegen, Enter schaltet.',
  // --- additions: basics ---
  buttonBusy: 'Speichert…',
  chipRemoveAria: '{label} entfernen',
  iconButtonBadgeAria: '{label}, {n}',
  // --- additions: overlays ---
  sheetExpand: 'Auf volle Höhe vergrößern',
  sheetCollapse: 'Auf halbe Höhe verkleinern',
  // --- additions: shell ---
  // --- additions: heute ---
  emptyRoutinesToday: 'Heute steht keine Routine an.',
  routinesDoneAria: '{done} von {n} heute erledigt',
  habitToggleWeekAria: '{name}: heute erledigt, {done} von {target} in dieser Woche',
  moodChoiceAria: '{n} von 5: {label}',
  moodLoggedAtAria: 'Eingetragen um {time}',
  dueCount: '({n})',
  firstStepNoteAction: 'Notiz schreiben',
  cardDismissNamed: '{label}: Karte ausblenden',
  journalRequired: 'Bitte einen Text eingeben.',
  journalEarlier: 'Heute bereits notiert',
  // --- additions: sheets ---
  habitRhythmLine: '{rhythm} · {period}',
  habitWeekdaysRequired: 'Wähle mindestens einen Wochentag.',
  habitIntervalInvalid: 'Gib eine ganze Zahl ab 1 ein.',
  habitTimesInvalid: 'Gib eine ganze Zahl von 1 bis 7 ein.',
  reminderModeAria: 'Art der Erinnerung',
  reminderOffsetInvalid: 'Gib eine ganze Zahl von Minuten ab 0 ein.',
  reminderAtRequired: 'Wähle Datum und Uhrzeit.',
  // --- additions: start-settings ---
  exportLast: 'Letzter Export: {date}, {time}',
  importNewDeviceHint: 'Auf einem neuen Gerät „Wiederherstellen“ wählen, damit keine Bereiche doppelt entstehen.',
  persistAction: 'Dauerhaft speichern',
  reminderHintClosed: 'Ist die Seite geschlossen, erscheinen fällige Erinnerungen gesammelt beim nächsten Öffnen.',
  areaRenameAria: '{name} umbenennen',
  areaArchiveAria: '{name} archivieren',
  areaUnarchiveAria: '{name} reaktivieren',
  areaLastActive: 'Der letzte aktive Bereich lässt sich nicht archivieren.',
  toastAreaCreated: 'Bereich angelegt',
  toastAreaArchived: 'Bereich archiviert',
  toastAreaUnarchived: 'Bereich reaktiviert',
  infoProvenance: 'Pflanzengeometrie nach der Vorlage „Tend – A Habit Garden“',
  wissenNoteSavedOne: '1 Notiz ist gespeichert. Neue Notizen legst du mit + an; alle sind im JSON-Export enthalten.',
  wissenNotesSaved: '{n} Notizen sind gespeichert. Neue Notizen legst du mit + an; alle sind im JSON-Export enthalten.',
  // --- additions: integration ---
} as const;

export type TextKey = keyof typeof t;

/** Fills {placeholders} in a template. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

const STAGE_KEYS = ['stage0', 'stage1', 'stage2', 'stage3', 'stage4'] as const;
export function stageName(stage: Stage): string {
  return t[STAGE_KEYS[stage]];
}

const WEEKDAY_KEYS = ['weekdayShort1', 'weekdayShort2', 'weekdayShort3', 'weekdayShort4', 'weekdayShort5', 'weekdayShort6', 'weekdayShort7'] as const;
/** ISO weekday 1 = Monday … 7 = Sunday. */
export function weekdayShort(isoWeekday: number): string {
  return t[WEEKDAY_KEYS[(isoWeekday - 1 + 7) % 7] ?? 'weekdayShort1'];
}

const MOOD_KEYS = ['mood1', 'mood2', 'mood3', 'mood4', 'mood5'] as const;
export function moodLabel(value: 1 | 2 | 3 | 4 | 5): string {
  return t[MOOD_KEYS[value - 1] ?? 'mood3'];
}

const FLOWER_KEYS: Record<FlowerId, TextKey> = {
  bellis: 'flowerBellis', calendula: 'flowerCalendula', helianthus: 'flowerHelianthus', centaurea: 'flowerCentaurea',
  passiflora: 'flowerPassiflora', matricaria: 'flowerMatricaria', leucanthemum: 'flowerLeucanthemum', generic: 'flowerGeneric',
};
export function flowerName(flower: FlowerId): string {
  return t[FLOWER_KEYS[flower]];
}

const AREA_DESC_KEYS: Partial<Record<FlowerId, TextKey>> = {
  bellis: 'areaDescBellis', calendula: 'areaDescCalendula', helianthus: 'areaDescHelianthus', centaurea: 'areaDescCentaurea',
  passiflora: 'areaDescPassiflora', matricaria: 'areaDescMatricaria', leucanthemum: 'areaDescLeucanthemum',
};
export function areaDescription(flower: FlowerId): string {
  const key = AREA_DESC_KEYS[flower];
  return key ? t[key] : t.onbCustomAreaDesc;
}
