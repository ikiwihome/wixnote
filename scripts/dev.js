import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--watch', 'server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    stdio: 'inherit',
  }),
];
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    children.forEach((p) => p.kill());
    process.exit();
  });
for (const child of children)
  child.on('exit', (code) => {
    if (code) {
      children.forEach((p) => p.kill());
      process.exit(code);
    }
  });
