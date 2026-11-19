// The preflight must distinguish "operator has not supplied a key yet" from a
// broken local setup, and it must never imply that a remote step ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { inspectWeb3Readiness } from '../tools/preflight.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const everything = new Set([
  path.join(repoRoot, 'artifacts', 'SumoCoin.json'),
  path.join(repoRoot, 'artifacts', 'SumoCollection.json'),
  path.join(repoRoot, 'app', 'data', 'collection.json'),
  path.join(repoRoot, 'render.yaml'),
]);
const publicRoot = path.join(repoRoot, 'public') + path.sep;
const exists = (file) => {
  const resolved = path.resolve(file);
  return resolved.startsWith(publicRoot) || everything.has(resolved);
};

const readyEnv = {
  SEPOLIA_RPC_URL: 'https://sepolia.example.invalid',
  DEPLOYER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
  SUMO_CLAIM_SIGNER_ADDRESS: '',
  PINATA_JWT: 'pinata-test-token-long-enough',
  RENDER_API_KEY: 'render-test-key',
};

test('reports a ready local setup', () => {
  const { ready, rows } = inspectWeb3Readiness({ env: readyEnv, repoRoot, exists });
  assert.equal(ready, true);
  assert.ok(rows.every((entry) => entry.status === 'ok'));
});

test('names each missing credential instead of failing silently', () => {
  const { ready, rows } = inspectWeb3Readiness({ env: {}, repoRoot, exists });
  assert.equal(ready, false);
  const missing = rows.filter((entry) => entry.status === 'missing').map((entry) => entry.name);
  assert.deepEqual(missing, [
    'SEPOLIA_RPC_URL',
    'DEPLOYER_PRIVATE_KEY',
    'PINATA_JWT',
    'RENDER_API_KEY',
  ]);
});

test('rejects a malformed deployer key and RPC URL', () => {
  const { rows } = inspectWeb3Readiness({
    env: { ...readyEnv, DEPLOYER_PRIVATE_KEY: '0xnothex', SEPOLIA_RPC_URL: 'not-a-url' },
    repoRoot,
    exists,
  });
  const missing = rows.filter((entry) => entry.status === 'missing').map((entry) => entry.name);
  assert.deepEqual(missing, ['SEPOLIA_RPC_URL', 'DEPLOYER_PRIVATE_KEY']);
});
