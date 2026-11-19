import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test('HTTP RPC adapter returns 405 instead of 500 for GET requests', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sumo-server-test-'));
  const port = await availablePort();
  const child = spawn(process.execPath, ['app/backend/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      SUMO_CLAIM_STORE: path.join(directory, 'claims.json'),
      SUMO_GAME_STORE: path.join(directory, 'game.json'),
      SUMO_COIN_ADDRESS: '',
      SUMO_COLLECTION_ADDRESS: '',
      SUMO_CLAIM_SIGNER_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let timer;
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('[sumo-classic-craft]')) resolve();
    });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`server exited (${code}): ${output}`)));
    timer = setTimeout(() => reject(new Error(`server startup timed out: ${output}`)), 8000);
  });
  try {
    await ready;
    const response = await fetch(`http://127.0.0.1:${port}/api/rpc`);
    assert.equal(response.status, 405);
    const body = await response.json();
    assert.equal(body.error.message, 'POST required.');
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
