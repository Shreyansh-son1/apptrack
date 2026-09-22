import Database from 'better-sqlite3';

/**
 * SQLite, one file on disk. It is enough for a single-user tracker and it
 * keeps the project runnable with no external service. See README for the
 * point at which this choice stops being reasonable.
 */
export function openDatabase(file = 'apptrack.db'): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id          TEXT PRIMARY KEY,
      company     TEXT NOT NULL,
      role        TEXT NOT NULL,
      source      TEXT NOT NULL,
      status      TEXT NOT NULL,
      applied_on  TEXT,
      follow_up_on TEXT,
      url         TEXT,
      notes       TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status
      ON applications (status);

    CREATE INDEX IF NOT EXISTS idx_applications_follow_up
      ON applications (follow_up_on);
  `);
}
