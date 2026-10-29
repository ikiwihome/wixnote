import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
const email = process.argv[2],
  file = path.join(process.env.DATA_DIR || 'data', 'index.json');
if (!email || !existsSync(file)) {
  console.error(
    'Usage: node scripts/reset-password.js account@example.com (with DATA_DIR configured)',
  );
  process.exit(1);
}
const findUser = (index) =>
  index.users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase());
if (!findUser(JSON.parse(readFileSync(file, 'utf8')))) {
  console.error('Account not found');
  process.exit(1);
}
let password = process.env.WIX_RESET_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('An interactive terminal or WIX_RESET_PASSWORD is required');
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
  process.exit(1);
}
const salt = randomBytes(16).toString('hex'),
  encoded = salt + ':' + scryptSync(password, salt, 64).toString('hex');
// Re-read right before writing; the running server reloads index.json when it changes.
const index = JSON.parse(readFileSync(file, 'utf8')),
  user = findUser(index);
user.password = encoded;
index.sessions = index.sessions.filter((session) => session.user_id !== user.id);
const temporary = file + '.' + process.pid + '.tmp';
writeFileSync(temporary, JSON.stringify(index, null, 2));
renameSync(temporary, file);
console.log('Password reset; existing sessions have been revoked.');
