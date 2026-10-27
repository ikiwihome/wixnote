import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
const email = process.argv[2],
  file = path.join(process.env.DATA_DIR || 'data', 'wixnote.sqlite');
if (!email || !existsSync(file)) {
  console.error(
    'Usage: node scripts/reset-password.js account@example.com (with DATA_DIR configured)',
  );
  process.exit(1);
}
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=5000');
if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
  console.error('Account not found');
  db.close();
  process.exit(1);
}
let password = process.env.WIX_RESET_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('An interactive terminal or WIX_RESET_PASSWORD is required');
    db.close();
    process.exit(1);
  }
  process.stdout.write('New password (10+ characters): ');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  password = await new Promise((resolve) => {
    let value = '';
    const handler = (str, key) => {
      if (key?.ctrl && key.name === 'c') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        process.exit(1);
      }
      if (key?.name === 'return') {
        process.stdin.off('keypress', handler);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (key?.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (str && !key?.ctrl && !key?.meta) {
        value += str;
      }
    };
    process.stdin.on('keypress', handler);
  });
}
if (password.length < 10 || password.length > 200) {
  console.error('Password must contain 10–200 characters');
  db.close();
  process.exit(1);
}
const salt = randomBytes(16).toString('hex'),
  encoded = salt + ':' + scryptSync(password, salt, 64).toString('hex');
db.exec('BEGIN IMMEDIATE');
try {
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  db.exec('COMMIT');
  console.log('Password reset; existing sessions have been revoked.');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
} finally {
  db.close();
}
