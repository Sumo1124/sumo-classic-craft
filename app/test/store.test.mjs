import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaimStore, createGameStore } from '../backend/store.mjs';

const ADDRESS_A = `0x${'a'.repeat(40)}`;
const ADDRESS_B = `0x${'b'.repeat(40)}`;

test('nonces increase monotonically per address', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-store-')), 'claims.json');
  const store = createClaimStore(file);
  assert.equal(store.nextNonce(ADDRESS_A), 1n);
  assert.equal(store.nextNonce(ADDRESS_A), 2n);
  assert.equal(store.nextNonce(ADDRESS_B), 1n);
  assert.equal(store.peek(ADDRESS_A), 2n);
});

test('nonces persist across store instances', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-store-')), 'claims.json');
  const first = createClaimStore(file);
  first.nextNonce(ADDRESS_A);
  first.nextNonce(ADDRESS_A);
  const second = createClaimStore(file);
  assert.equal(second.nextNonce(ADDRESS_A), 3n);
});

test('a missing file starts empty instead of throwing', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-store-')), 'claims.json');
  const store = createClaimStore(file);
  assert.equal(store.peek(ADDRESS_A), 0n);
});

test('a corrupt nonce file fails closed instead of reusing nonces', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-store-')), 'claims.json');
  writeFileSync(file, '{broken');
  assert.throws(() => createClaimStore(file), /Claim store is corrupt/);
});

function gameFile() {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-store-')), 'game.json');
}

test('legacy game saves migrate additively without losing existing rewards or sessions', () => {
  const file = gameFile();
  const voucher = { signature: '0xlegacy', nonce: '1' };
  const legacy = {
    sessions: {
      legacy: { id: 'legacy', address: ADDRESS_A, startedAt: 123, completed: false },
    },
    earned: { [`${ADDRESS_A}:1`]: voucher },
    localEarned: { [`${ADDRESS_A}:1`]: 25 },
    best: { [`${ADDRESS_A}:1`]: { moves: 9, durationMs: 5000 } },
  };
  writeFileSync(file, JSON.stringify(legacy));
  const store = createGameStore(file);
  assert.deepEqual(store.getSession('legacy'), legacy.sessions.legacy);
  assert.deepEqual(store.getVoucher(ADDRESS_A, 1), voucher);
  assert.equal(store.hasLocalEarned(ADDRESS_A, 1), true);
  assert.deepEqual(store.dailyProgress(ADDRESS_A, '2026-11-17'), {
    steps: {}, completion: 0, claimedTotal: 0, completed: false,
  });

  store.setLocalEarned(ADDRESS_A, 2, 50);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.dailyEarned, {});
  assert.deepEqual(saved.sessions, legacy.sessions);
  assert.deepEqual(saved.earned, legacy.earned);
  assert.deepEqual(saved.best, legacy.best);
  assert.equal(store.progress(ADDRESS_A).localBalance, 75);

  const reopened = createGameStore(file);
  assert.deepEqual(reopened.getVoucher(ADDRESS_A, 1), voucher);
  assert.equal(reopened.progress(ADDRESS_A).localBalance, 75);
});

test('daily ledgers persist and contribute to aggregate local balances once', () => {
  const file = gameFile();
  const store = createGameStore(file);
  store.setLocalEarned(ADDRESS_A, 1, 25);
  assert.equal(store.awardDaily(ADDRESS_A, '2026-11-16', 1, 5, 20).localBalance, 30);
  assert.equal(store.awardDaily(ADDRESS_A, '2026-11-16', 2, 10, 20).localBalance, 40);
  const third = store.awardDaily(ADDRESS_A, '2026-11-16', 3, 15, 20);
  assert.equal(third.stepReward, 15);
  assert.equal(third.completionReward, 20);
  assert.equal(third.localBalance, 75);
  assert.deepEqual(store.dailyProgress(ADDRESS_A, '2026-11-16'), {
    steps: { 1: 5, 2: 10, 3: 15 },
    completion: 20,
    claimedTotal: 50,
    completed: true,
  });

  const replay = store.awardDaily(ADDRESS_A, '2026-11-16', 3, 15, 20);
  assert.equal(replay.stepReward, 0);
  assert.equal(replay.completionReward, 0);
  assert.equal(replay.localBalance, 75);
  for (const [step, reward] of [5, 10, 15].entries()) {
    store.awardDaily(ADDRESS_A, '2026-11-17', step + 1, reward, 20);
  }
  assert.equal(store.progress(ADDRESS_A).localBalance, 125);

  const reopened = createGameStore(file);
  assert.equal(reopened.progress(ADDRESS_A).localBalance, 125);
  assert.equal(reopened.dailyProgress(ADDRESS_A, '2026-11-16').claimedTotal, 50);
  assert.equal(reopened.dailyProgress(ADDRESS_A, '2026-11-17').claimedTotal, 50);
  reopened.setLocalEarned(ADDRESS_B, 1, 50);
  reopened.awardDaily(ADDRESS_B, '2026-11-17', 1, 5, 20);
  assert.equal(reopened.progress(ADDRESS_A).localBalance, 125);
  assert.equal(reopened.progress(ADDRESS_B).localBalance, 55);
});

test('best scores migrate to moves only and only improve for fewer moves', () => {
  const file = gameFile();
  writeFileSync(file, JSON.stringify({
    best: { [`${ADDRESS_A}:1`]: { moves: 9, durationMs: 5000 } },
  }));
  const store = createGameStore(file);
  store.setBest(ADDRESS_A, 1, { moves: 8, durationMs: 60_000 });
  assert.deepEqual(store.progress(ADDRESS_A).best[1], { moves: 8 });
  store.setBest(ADDRESS_A, 1, { moves: 10, durationMs: 1 });
  assert.deepEqual(store.progress(ADDRESS_A).best[1], { moves: 8 });
  const reopened = createGameStore(file);
  assert.deepEqual(reopened.progress(ADDRESS_A).best[1], { moves: 8 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).best[`${ADDRESS_A}:1`], { moves: 8 });
});

test('age pruning removes completed history but retains unfinished sessions', () => {
  const file = gameFile();
  const store = createGameStore(file);
  const old = Date.now() - 48 * 60 * 60 * 1000;
  store.saveSession({ id: 'unfinished', address: ADDRESS_A, startedAt: old, completed: false });
  store.saveSession({ id: 'completed', address: ADDRESS_A, startedAt: old, completed: true });
  store.saveSession({ id: 'fresh', address: ADDRESS_A, startedAt: Date.now(), completed: false });
  assert.ok(store.getSession('unfinished'));
  assert.equal(store.getSession('completed'), null);
  assert.ok(store.getSession('fresh'));
  const reopened = createGameStore(file);
  assert.ok(reopened.getSession('unfinished'));
  assert.equal(reopened.getSession('completed'), null);
});

test('invalid daily reward ledgers fail closed', () => {
  const file = gameFile();
  const key = `${ADDRESS_A}:2026-11-17`;
  const invalidLedgers = [
    [],
    { [key]: null },
    { [key]: { steps: [], completion: 0 } },
    { [key]: { steps: { 1: -5 }, completion: 0 } },
    { [key]: { steps: { 1: 5 }, completion: -20 } },
    { [key]: { steps: { 1: 5 }, completion: '20' } },
  ];
  for (const dailyEarned of invalidLedgers) {
    writeFileSync(file, JSON.stringify({ dailyEarned }));
    assert.throws(() => createGameStore(file), /invalid daily reward ledger/);
  }
});
