// CONTRACT STUB – implemented in AP5.
import type { TableName } from '../db.js';
import type { ISO } from '../model.js';

export interface ExportFile {
  format: 'olife';
  version: 1;
  exportedAt: ISO;
  tables: Record<TableName, unknown[]>;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Snapshot of all ten tables. */
export function buildExport(): Promise<ExportFile> {
  throw new Error('not implemented: buildExport');
}

/** Downloads olife-backup-JJJJ-MM-TT.json via <a download>; sets profile.lastExportAt. */
export function exportJson(): Promise<void> {
  throw new Error('not implemented: exportJson');
}

/**
 * Parses and validates a file (format, version, all tables are arrays,
 * every record has its key field with the right type). Throws ImportError.
 */
export function parseImport(text: string): ExportFile {
  throw new Error(`not implemented: parseImport ${text.length}`);
}

export interface MergeResult { created: number; updated: number }

/**
 * "Zusammenführen" in one rw transaction: per key the newer updatedAt wins
 * (ties keep local); HabitLogs are united, 'done' beats 'skipped'; tags united
 * by path; moodLogs: newer loggedAt wins per day; dayPlans: local wins;
 * profile: local wins (file profile only when none exists locally).
 */
export function importMerge(file: ExportFile): Promise<MergeResult> {
  throw new Error(`not implemented: importMerge ${file.exportedAt}`);
}

/** "Wiederherstellen": clears all tables and writes the file, atomically. Returns the record count. */
export function importRestore(file: ExportFile): Promise<number> {
  throw new Error(`not implemented: importRestore ${file.exportedAt}`);
}

/** "Alle Daten löschen": Dexie.delete() of the database. */
export function deleteAllData(): Promise<void> {
  throw new Error('not implemented: deleteAllData');
}
