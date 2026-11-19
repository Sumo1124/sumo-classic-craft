import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { createGame, dealDeck, stageClearMessage, STAGES } from '../backend/game.mjs';
import { createGameStore } from '../backend/store.mjs';

// Well-known Hardhat/Anvil test accounts. Never real secrets.
const PLAYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const OTHER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const VERIFYING_CONTRACT = `0x${'c'.repeat(40)}`;
const TIMING_FIELDS = new Set(['timeLimitSec', 'deadline', 'durationMs']);

function assertNoTimingFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    assert.equal(TIMING_FIELDS.has(key), false, `Unexpected public timing field: ${key}`);
    assertNoTimingFields(entry);
  }
}

function memoryStore() {
  const sessions = new Map();
  const earned = new Map();
  const localEarned = new Map();
  const best = new Map();
  const key = (address, stageId) => `${address.toLowerCase()}:${stageId}`;
  return {
    saveSession(session) { sessions.set(session.id, session); },
    getSession(id) { return sessions.get(id) ?? null; },
    hasEarned(address, stageId) { return earned.has(key(address, stageId)); },
    getVoucher(address, stageId) { return earned.get(key(address, stageId)) ?? null; },
    setEarned(address, stageId, voucher) { earned.set(key(address, stageId), voucher); },
    hasLocalEarned(address, stageId) { return localEarned.has(key(address, stageId)); },
    setLocalEarned(address, stageId, reward) { localEarned.set(key(address, stageId), reward); },
    setBest(address, stageId, score) { best.set(key(address, stageId), score); },
    progress(address) {
      const prefix = `${address.toLowerCase()}:`;
      const ownRewards = [...localEarned].filter(([entry]) => entry.startsWith(prefix));
      return {
        earned: ownRewards.map(([entry]) => Number(entry.split(':')[1])),
        best: Object.fromEntries([...best].filter(([entry]) => entry.startsWith(prefix)).map(([entry, score]) => [entry.split(':')[1], score])),
        localBalance: ownRewards.reduce((sum, [, reward]) => sum + reward, 0),
      };
    },
  };
}

function harness({ signed = true, store = memoryStore(), deferred = false, failFirstSign = false } = {}) {
  const signatures = [];
  let time = 1_000_000;
  const nonces = new Map();
  let release;
  let entered;
  const signingStarted = deferred ? new Promise((resolve) => { entered = resolve; }) : null;
  const gate = deferred ? new Promise((resolve) => { release = resolve; }) : null;
  const claimSigner = signed ? {
    chainId: 11155111,
    verifyingContract: VERIFYING_CONTRACT,
    async signClaim(message) {
      if (failFirstSign) {
        failFirstSign = false;
        throw new Error('Signer temporarily unavailable.');
      }
      signatures.push(message);
      if (deferred) {
        entered();
        await gate;
      }
      return { signature: `0x${'d'.repeat(130)}` };
    },
  } : null;
  const game = createGame({
    store,
    claimSigner,
    nextNonce: (address) => {
      const key = address.toLowerCase();
      const nonce = (nonces.get(key) ?? 0n) + 1n;
      nonces.set(key, nonce);
      return nonce;
    },
    itemCount: 8,
    now: () => time,
  });
  return {
    game,
    store,
    signatures,
    signingStarted,
    releaseSigning() { release(); },
    advance(ms) { time += ms; },
  };
}

function flipInput(session, index, address = PLAYER.address) {
  return { address, stageId: session.stage.id, sessionId: session.sessionId, index };
}

async function solve(h, stageId = 1, player = PLAYER, address = player.address, guardianId) {
  const session = h.game.start(address, stageId, guardianId);
  assert.equal('deck' in session, false);
  const stored = h.store.getSession(session.sessionId);
  const pairs = new Map();
  stored.deck.forEach((item, index) => pairs.set(item, [...(pairs.get(item) ?? []), index]));
  h.advance(5000);
  let last;
  for (const [a, b] of pairs.values()) {
    await h.game.flip(flipInput(session, a, address));
    last = await h.game.flip(flipInput(session, b, address));
  }
  assert.equal(last.solved, true);
  assert.equal(last.moves, session.stage.pairs);
  return session;
}

async function clearSignature(session, player = PLAYER, address = player.address) {
  return player.signMessage({
    message: stageClearMessage({ address, stageId: session.stage.id, sessionId: session.sessionId }),
  });
}

async function completeValid(h, stageId = 1, player = PLAYER, address = player.address, guardianId) {
  const session = await solve(h, stageId, player, address, guardianId);
  const signature = await clearSignature(session, player, address);
  const result = await h.game.complete({
    address,
    stageId,
    sessionId: session.sessionId,
    signature,
  });
  return { session, result };
}

async function expectGameError(promise, message, status = 400) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    assert.equal(error.status, status);
    return true;
  });
}

test('all stages hide their decks and store two of each distinct item', () => {
  const h = harness();
  assert.equal(STAGES.length, 6);
  assert.equal(STAGES.reduce((sum, stage) => sum + stage.reward, 0), 825);
  assertNoTimingFields(STAGES);
  for (const stage of STAGES) {
    const session = h.game.start(PLAYER.address, stage.id);
    assertNoTimingFields(session);
    assert.equal(session.cardCount, stage.pairs * 2);
    assert.equal('deck' in session, false);
    const { deck } = h.store.getSession(session.sessionId);
    const counts = new Map();
    for (const item of deck) {
      assert.ok(Number.isInteger(item) && item >= 0 && item < 8);
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
    assert.equal(counts.size, stage.pairs);
    assert.ok([...counts.values()].every((count) => count === 2));
  }
  assert.deepEqual(dealDeck(4, 8, 12345), dealDeck(4, 8, 12345));
});

test('start and flip reject invalid addresses, stages, sessions and card indexes', async () => {
  const h = harness();
  assert.throws(() => h.game.start('not-an-address', 1), /valid wallet address/);
  assert.throws(() => h.game.start(PLAYER.address, 99), /Unknown stage/);
  const session = h.game.start(PLAYER.address, 1);
  assert.throws(() => h.game.flip(flipInput(session, 0, OTHER.address)), /Session not found/);
  assert.throws(() => h.game.flip(flipInput(session, -1)), /outside the deck/);
  assert.throws(() => h.game.flip(flipInput(session, 6)), /outside the deck/);
  h.game.flip(flipInput(session, 0));
  assert.throws(() => h.game.flip(flipInput(session, 0)), /cannot be flipped again/);
});

test('a forged completion is rejected before the server tracks a solved board', async () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 1);
  h.advance(5000);
  await expectGameError(h.game.complete({
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  }), 'The encounter is not solved yet.', 409);
});

test('a clear requires a signature from the session wallet', async () => {
  const h = harness();
  const session = await solve(h);
  const wrongSignature = await clearSignature(session, OTHER, PLAYER.address);
  await expectGameError(h.game.complete({
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: wrongSignature,
  }), 'The stage-clear signature does not match this wallet.', 401);
  const valid = await h.game.complete({
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  });
  assert.equal(valid.ok, true);
  const retry = await h.game.complete({
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  });
  assert.deepEqual(retry.voucher, valid.voucher);
  assert.equal(h.signatures.length, 1);
});

test('a failed voucher signature can be retried on the same solved session', async () => {
  const h = harness({ failFirstSign: true });
  const session = await solve(h);
  const input = {
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  };
  await assert.rejects(h.game.complete(input), /Signer temporarily unavailable/);
  assert.equal(h.store.getSession(session.sessionId).completed, false);
  const result = await h.game.complete(input);
  assert.equal(result.reward, 25);
  assert.equal(result.voucher.nonce, '2');
  assert.equal(h.store.getSession(session.sessionId).completed, true);
});

test('every stage signs its exact fixed reward with independent sequential nonces', async () => {
  const h = harness();
  for (const stage of STAGES) {
    const { result } = await completeValid(h, stage.id);
    assert.equal(result.reward, stage.reward);
    assert.equal(result.localReward, stage.reward);
    assert.equal(result.localBalance, STAGES.slice(0, stage.id).reduce((sum, entry) => sum + entry.reward, 0));
    assert.equal(result.moves, stage.pairs);
    assert.equal(result.voucher.amount, (BigInt(stage.reward) * 10n ** 18n).toString());
    assert.equal(result.voucher.nonce, String(stage.id));
    assert.equal(result.voucher.chainId, 11155111);
    assert.equal(result.voucher.verifyingContract, VERIFYING_CONTRACT);
  }
  const other = await completeValid(h, 1, OTHER);
  assert.equal(other.result.reward, 25);
  assert.equal(other.result.voucher.nonce, '1');
});

test('replays return the original voucher without another signature or nonce', async () => {
  const h = harness();
  const first = await completeValid(h);
  const replay = await completeValid(h);
  assert.equal(replay.result.reward, 25);
  assert.deepEqual(replay.result.voucher, first.result.voucher);
  assert.match(replay.result.message, /original SUMO reward voucher/);
  assert.equal(h.signatures.length, 1);
  const mixedCase = `0x${PLAYER.address.slice(2).toUpperCase()}`;
  const caseReplay = await completeValid(h, 1, PLAYER, mixedCase);
  assert.equal(caseReplay.result.voucher.nonce, '1');
  assert.equal(h.signatures.length, 1);
});

test('local clears earn coins once without consuming future Sepolia eligibility', async () => {
  const practice = harness({ signed: false });
  const cleared = await completeValid(practice);
  assert.equal(cleared.result.reward, 0);
  assert.equal(cleared.result.localReward, 25);
  assert.equal(cleared.result.localBalance, 25);
  assert.equal(cleared.result.voucher, null);
  assert.equal(practice.store.hasEarned(PLAYER.address, 1), false);
  assert.equal(practice.store.hasLocalEarned(PLAYER.address, 1), true);
  assert.deepEqual(practice.store.progress(PLAYER.address).best['1'], { moves: 3 });

  const replay = await completeValid(practice);
  assert.equal(replay.result.localReward, 0);
  assert.equal(replay.result.localBalance, 25);

  const signed = harness({ store: practice.store });
  const rewarded = await completeValid(signed);
  assert.equal(rewarded.result.reward, 25);
  assert.equal(rewarded.result.localReward, 0);
  assert.equal(rewarded.result.localBalance, 25);
  assert.ok(rewarded.result.voucher);
});

test('concurrent first clears cannot issue two rewards', async () => {
  const h = harness({ deferred: true });
  const first = completeValid(h);
  await h.signingStarted;
  const second = completeValid(h);
  await expectGameError(second, 'Reward signing is already in progress for this stage.', 409);
  h.releaseSigning();
  const { result } = await first;
  assert.equal(result.reward, 25);
  assert.equal(h.signatures.length, 1);
  assert.equal(result.voucher.nonce, '1');
});

test('Carrick opens each encounter with a matching pair hint', () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 1, 'carrick-vale');
  const { deck } = h.store.getSession(session.sessionId);
  assert.equal(session.guardian.id, 'carrick-vale');
  assert.equal(session.hint.kind, 'pair');
  assert.equal(session.hint.indexes.length, 2);
  const [a, b] = session.hint.indexes;
  assert.notEqual(a, b);
  assert.equal(deck[a], deck[b]);
  assert.equal(session.hint.itemIndex, deck[a]);
});

test('Whispering makes only the first mismatch free', () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 1, 'whispering-marsh');
  const { deck } = h.store.getSession(session.sessionId);
  const a = 0;
  const b = deck.findIndex((item, index) => index !== a && item !== deck[a]);
  h.game.flip(flipInput(session, a));
  const free = h.game.flip(flipInput(session, b));
  assert.equal(free.matched, false);
  assert.equal(free.moves, 0);
  assert.equal(free.skillTriggered, true);
  assert.equal(free.hint, null);

  const c = deck.findIndex((_, index) => index !== a && index !== b);
  const d = deck.findIndex((item, index) => index !== c && item !== deck[c]);
  h.game.flip(flipInput(session, c));
  const scored = h.game.flip(flipInput(session, d));
  assert.equal(scored.matched, false);
  assert.equal(scored.moves, 1);
  assert.equal(scored.skillTriggered, false);
});

test('Emberpeak reveals a flipped card mate on only the first mismatch', () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 1, 'emberpeak');
  const { deck } = h.store.getSession(session.sessionId);
  const a = 0;
  const b = deck.findIndex((item, index) => index !== a && item !== deck[a]);
  h.game.flip(flipInput(session, a));
  const first = h.game.flip(flipInput(session, b));
  assert.equal(first.matched, false);
  assert.equal(first.moves, 1);
  assert.equal(first.skillTriggered, true);
  assert.equal(first.hint.kind, 'mate');
  assert.equal(first.hint.sourceIndex, a);
  assert.equal(first.hint.indexes.length, 1);
  const [mate] = first.hint.indexes;
  assert.notEqual(mate, a);
  assert.equal(deck[mate], deck[a]);
  assert.equal(first.hint.itemIndex, deck[a]);

  const c = deck.findIndex((_, index) => index !== a && index !== b);
  const d = deck.findIndex((item, index) => index !== c && item !== deck[c]);
  h.game.flip(flipInput(session, c));
  const second = h.game.flip(flipInput(session, d));
  assert.equal(second.matched, false);
  assert.equal(second.skillTriggered, false);
  assert.equal(second.hint, null);
});

test('guardian choices never change chapter coin rewards', async () => {
  for (const guardianId of ['carrick-vale', 'whispering-marsh', 'emberpeak']) {
    const h = harness({ signed: false });
    const { result } = await completeValid(h, 1, PLAYER, PLAYER.address, guardianId);
    assert.equal(result.localReward, 25);
    assert.equal(result.localBalance, 25);
    assert.equal(result.reward, 0);
    assert.equal(result.voucher, null);
  }
});

test('legacy timed sessions remain playable after long delays and expose only move scores', async () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 6);
  const stored = h.store.getSession(session.sessionId);
  delete stored.mode;
  delete stored.guardianId;
  delete stored.skillUsed;
  stored.timeLimitSec = 1;
  const pairs = new Map();
  stored.deck.forEach((item, index) => pairs.set(item, [...(pairs.get(item) ?? []), index]));
  h.advance(90 * 24 * 60 * 60 * 1000);
  const flips = [];
  for (const [a, b] of pairs.values()) {
    flips.push(h.game.flip(flipInput(session, a)));
    flips.push(h.game.flip(flipInput(session, b)));
  }
  assert.equal(flips.at(-1).solved, true);
  const result = await h.game.complete({
    address: PLAYER.address,
    stageId: 6,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  });
  assert.equal(result.moves, session.stage.pairs);
  assertNoTimingFields(flips);
  assertNoTimingFields(result);
  assertNoTimingFields(h.game.stages(PLAYER.address));
  assert.deepEqual(h.store.progress(PLAYER.address).best['6'], { moves: session.stage.pairs });
});

test('implausibly fast and negative clear times remain rejected', async () => {
  const h = harness();
  const session = h.game.start(PLAYER.address, 1);
  const stored = h.store.getSession(session.sessionId);
  const pairs = new Map();
  stored.deck.forEach((item, index) => pairs.set(item, [...(pairs.get(item) ?? []), index]));
  for (const [a, b] of pairs.values()) {
    h.game.flip(flipInput(session, a));
    h.game.flip(flipInput(session, b));
  }
  const input = {
    address: PLAYER.address,
    stageId: 1,
    sessionId: session.sessionId,
    signature: await clearSignature(session),
  };
  await expectGameError(h.game.complete(input), 'The clear time is outside the plausible range.');
  stored.solvedAt = stored.startedAt - 1;
  await expectGameError(h.game.complete(input), 'The clear time is outside the plausible range.');
});

test('real JSON storage preserves practice eligibility, vouchers and completed sessions', async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-game-')), 'game.json');
  const practice = harness({ signed: false, store: createGameStore(file) });
  const practiced = await completeValid(practice);
  assert.equal(practiced.result.reward, 0);
  assert.equal(practiced.result.localReward, 25);
  assert.equal(practiced.result.localBalance, 25);

  const signed = harness({ store: createGameStore(file) });
  const paid = await completeValid(signed);
  assert.equal(paid.result.reward, 25);
  assert.equal(paid.result.localReward, 0);
  assert.equal(paid.result.localBalance, 25);
  const restored = harness({ store: createGameStore(file) });
  const restoredRetry = await restored.game.complete({
    address: PLAYER.address,
    stageId: 1,
    sessionId: paid.session.sessionId,
    signature: await clearSignature(paid.session),
  });
  assert.deepEqual(restoredRetry.voucher, paid.result.voucher);
  const replay = await completeValid(restored);
  assert.deepEqual(replay.result.voucher, paid.result.voucher);
  assert.equal(restored.signatures.length, 0);
});

test('a corrupt game store fails closed instead of reopening rewards', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-game-')), 'game.json');
  writeFileSync(file, '{broken');
  assert.throws(() => createGameStore(file), /Game store is corrupt/);
});
