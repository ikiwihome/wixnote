import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'wixnote.sqlite'));
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) {
    db.close();
    throw new Error('Database schema is newer than this application');
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE COLLATE NOCASE,name TEXT NOT NULL,password TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS folders(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,parent_id TEXT REFERENCES folders(id),name TEXT NOT NULL,position INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tags(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,color TEXT DEFAULT '#7084a4',UNIQUE(user_id,name));
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',text TEXT NOT NULL DEFAULT '',type TEXT NOT NULL DEFAULT 'common',favorite INTEGER DEFAULT 0,pinned INTEGER DEFAULT 0,deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,share_token TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS notes_owner ON notes(user_id,deleted_at,updated_at);
    CREATE TABLE IF NOT EXISTS note_tags(note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,tag_id TEXT REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(note_id,tag_id));
    CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS revisions_note ON revisions(note_id,version);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,value TEXT NOT NULL DEFAULT '{}');
  `);
  transaction(db, () => {
    for (const table of ['notes', 'revisions']) {
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((column) => column.name === 'editor_data')
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN editor_data TEXT`);
    }
    db.exec('PRAGMA user_version=2');
  });
  return db;
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
