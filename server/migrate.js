import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// One-time import of a 1.x SQLite data directory into the HTML files + JSON index layout.
// The SQLite file is left in place so the upgrade can be rolled back.
export function migrateSqlite(directory, store) {
  const file = path.join(directory, 'wixnote.sqlite');
  if (existsSync(path.join(directory, 'index.json')) || !existsSync(file)) return false;
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const all = (sql) => db.prepare(sql).all();
    const has = (table) =>
      !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const tagsByNote = new Map();
    for (const row of all('SELECT * FROM note_tags'))
      tagsByNote.set(row.note_id, [...(tagsByNote.get(row.note_id) || []), row.tag_id]);
    store.transaction(() => {
      const data = store.data;
      data.users = all('SELECT * FROM users ORDER BY rowid');
      data.sessions = all('SELECT * FROM sessions');
      data.apiKeys = has('api_keys') ? all('SELECT * FROM api_keys') : [];
      data.folders = all('SELECT * FROM folders');
      data.tags = all('SELECT * FROM tags');
      data.attachments = all('SELECT * FROM attachments');
      data.comments = all('SELECT * FROM comments');
      for (const row of all('SELECT * FROM settings'))
        try {
          data.settings[row.user_id] = JSON.parse(row.value);
        } catch {
          // Unreadable preferences fall back to defaults.
        }
      for (const { content, editor_data, ...row } of all('SELECT * FROM notes')) {
        delete row.text;
        data.notes.push({
          ...row,
          favorite: !!row.favorite,
          pinned: !!row.pinned,
          tags: tagsByNote.get(row.id) || [],
        });
        store.setBody('notes', row.id, content, editor_data ?? null);
      }
      for (const { content, editor_data, ...row } of all('SELECT * FROM revisions')) {
        data.revisions.push(row);
        store.setBody('revisions', row.id, content, editor_data ?? null);
      }
    });
  } finally {
    db.close();
  }
  return true;
}
