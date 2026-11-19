// Start path for Sumo Classic Craft: build the client on first run, then serve
// everything from app/backend/server.mjs. No Docker and no database.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
  console.log('[start] no client bundle found; building it (first run only)');
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (build.status !== 0) {
    console.error('[start] client build failed; nothing was started.');
    process.exit(build.status ?? 1);
  }
}

const server = spawn(process.execPath, [path.join(root, 'app', 'backend', 'server.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
server.on('error', (error) => {
  console.error(`[start] could not start the server: ${error.message}`);
  process.exitCode = 1;
});
server.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
