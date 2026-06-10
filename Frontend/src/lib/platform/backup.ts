import { db } from '../store/db';

/** Backup document version — matches the Dexie schema version it snapshots. */
const BACKUP_VERSION = 3;

/** localStorage key holding the app settings blob (see lib/store/settings.ts). */
const SETTINGS_KEY = 'govprep_settings';

/** Tables included in a backup, in export/restore order. */
const BACKUP_TABLES = [
  'topics',
  'flashcards',
  'activityLogs',
  'profiles',
  'plans',
  'contentCache',
  'caDigests',
  'mockAttempts',
  'studySessions',
  'achievements',
] as const;

/** Shape of an exported GovPrep backup file (version 3). */
export interface BackupFile {
  version: number;
  /** ISO datetime the export was taken. */
  exportedAt: string;
  /** Raw parsed contents of the govprep_settings localStorage entry (null when absent). */
  settings: unknown;
  /** Table name → array of rows, one entry per BACKUP_TABLES member. */
  tables: Record<string, unknown[]>;
}

/**
 * Serializes all user data (settings + every Dexie table) to a JSON string.
 * Date values (e.g. flashcard `due`/`last_review`) serialize naturally as ISO strings.
 */
export async function exportAll(): Promise<string> {
  const tables: Record<string, unknown[]> = {};
  for (const name of BACKUP_TABLES) {
    tables[name] = await db.table(name).toArray();
  }
  let settings: unknown;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    settings = raw ? JSON.parse(raw) : null;
  } catch {
    settings = null;
  }
  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    tables,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Exports all data and triggers a browser download of
 * `govprep-backup-YYYY-MM-DD.json`.
 */
export async function downloadBackup(): Promise<void> {
  const json = await exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `govprep-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Revives Date fields (`due`, `last_review`) on a flashcard row parsed from JSON. */
function reviveFlashcardDates(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) return row;
  const card: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  if (typeof card.due === 'string') card.due = new Date(card.due);
  if (typeof card.last_review === 'string') card.last_review = new Date(card.last_review);
  return card;
}

/**
 * Restores a backup produced by exportAll(): validates the document, writes the
 * settings blob back to localStorage, then bulkPuts every table inside a single
 * Dexie transaction (existing rows with matching keys are overwritten).
 *
 * @param json The backup file contents.
 * @returns Counts of tables and rows restored.
 * @throws Error with a user-friendly message when the file is invalid.
 */
export async function importAll(json: string): Promise<{ tables: number; rows: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON. Please choose a govprep-backup-*.json file.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('That file does not look like a GovPrep backup.');
  }
  const backup = parsed as Partial<BackupFile>;
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version (${String(backup.version)}). This app expects version ${BACKUP_VERSION}.`,
    );
  }
  if (typeof backup.tables !== 'object' || backup.tables === null || Array.isArray(backup.tables)) {
    throw new Error('This backup is missing its "tables" section — the file may be corrupted.');
  }

  if (backup.settings !== undefined && backup.settings !== null) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(backup.settings));
    } catch {
      // localStorage may be unavailable (private mode/quota); table restore still proceeds.
    }
  }

  const tableData = backup.tables as Record<string, unknown>;
  let tablesRestored = 0;
  let rowsRestored = 0;
  await db.transaction('rw', BACKUP_TABLES.map((name) => db.table(name)), async () => {
    for (const name of BACKUP_TABLES) {
      const rows = tableData[name];
      if (!Array.isArray(rows)) continue;
      const revived = name === 'flashcards' ? rows.map(reviveFlashcardDates) : rows;
      await db.table(name).bulkPut(revived);
      tablesRestored += 1;
      rowsRestored += rows.length;
    }
  });
  return { tables: tablesRestored, rows: rowsRestored };
}
