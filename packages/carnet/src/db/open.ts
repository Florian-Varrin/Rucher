import { DatabaseSync } from 'node:sqlite';
import { migrate } from './schema.ts';

export const MEMORY_DB = ':memory:';

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== MEMORY_DB) {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}
