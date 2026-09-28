// npm start — zero-to-writing in one command: ensure database → build → serve admin UI.
// Pass --no-open to skip the browser (servers, terminals without GUI).
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}`))));
});

console.log('Ayodhyya Writer — starting up…');
await run(['tools/db.mjs', '--init']);
await run(['tools/build.mjs']);

const admin = spawn(process.execPath, ['tools/preview.mjs', '--admin'], { cwd: ROOT, stdio: 'inherit' });
const url = 'http://localhost:8080/index.html';
if (!process.argv.includes('--no-open')) {
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${opener} "${url}"`, () => {});
}
console.log(`\nWriter UI: ${url}\nStop with Ctrl+C.`);
await new Promise((r) => admin.on('exit', r));
