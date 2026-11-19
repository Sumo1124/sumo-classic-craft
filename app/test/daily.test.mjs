import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { createGame, stageClearMessage } from '../backend/game.mjs';
import {
  DAILY_COMPLETION_REWARD,
  DAILY_STEP_REWARDS,
  DAILY_TOTAL_REWARD,
  dailyClearMessage,
  dailyPlan,
  utcDay,
} from '../backend/daily.mjs';

// Well-known Hardhat/Anvil test accounts. Never real secrets.
const PLAYER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const OTHER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
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
  const dailyEarned = new Map();
  const dailyKey = (address, date) => `${address.toLowerCase()}:${date}`;

  function dailyProgress(address, date) {
    const entry = dailyEarned.get(dailyKey(address, date)) ?? { steps: {}, completion: 0 };
    const steps = { ...entry.steps };
    const completion = Number(entry.completion ?? 0);
    const claimedTotal = Object.values(steps).reduce((sum, reward) => sum + reward, 0) + completion;
    return { steps, completion, claimedTotal, completed: completion > 0 };
  }

  function progress(address) {
    const prefix = `${address.toLowerCase()}:`;
    let localBalance = 0;
    for (const [key, entry] of dailyEarned) {
      if (!key.startsWith(prefix)) continue;
      localBalance += Object.values(entry.steps).reduce((sum, reward) => sum + reward, 0);
      localBalance += entry.completion;
    }
    return { earned: [], best: {}, localBalance };
  }

  return {
    saveSession(session) { sessions.set(session.id, session); },
    getSession(id) { return sessions.get(id) ?? null; },
    hasDailyStep(address, date, step) {
      const entry = dailyEarned.get(dailyKey(address, date));
      return Boolean(entry && Object.hasOwn(entry.steps, String(step)));
    },
    dailyProgress,
    awardDaily(address, date, step, reward, completionReward) {
      const key = dailyKey(address, date);
      const current = dailyEarned.get(key) ?? { steps: {}, completion: 0 };
      const next = { steps: { ...current.steps }, completion: current.completion };
      const stepKey = String(step);
      const stepReward = Object.hasOwn(next.steps, stepKey) ? 0 : reward;
      if (stepReward > 0) next.steps[stepKey] = reward;
      let awardedCompletion = 0;
      if ([1, 2, 3].every((position) => Object.hasOwn(next.steps, String(position))) && next.completion === 0) {
        next.completion = completionReward;
        awardedCompletion = completionReward;
      }
      if (stepReward > 0 || awardedCompletion > 0) dailyEarned.set(key, next);
      return {
        stepReward,
        completionReward: awardedCompletion,
        daily: dailyProgress(address, date),
        localBalance: progress(address).localBalance,
      };
    },
    progress,
  };
}

function harness({ store = memoryStore(), now = Date.UTC(2026, 10, 17, 12) } = {}) {
  let time = now;
  const nonceCalls = [];
  const claimSignatures = [];
  const game = createGame({
    store,
    claimSigner: {
      chainId: 11155111,
      verifyingContract: `0x${'c'.repeat(40)}`,
      async signClaim(message) {
        claimSignatures.push(message);
        return { signature: `0x${'d'.repeat(130)}` };
      },
    },
    nextNonce(address) {
      nonceCalls.push(address);
      return BigInt(nonceCalls.length);
    },
    itemCount: 8,
    now: () => time,
  });
  return {
    game,
    store,
    nonceCalls,
    claimSignatures,
    advance(ms) { time += ms; },
  };
}

function dailySignature(session, player = PLAYER, address = player.address) {
  return player.signMessage({
    message: dailyClearMessage({
      address,
      date: session.daily.date,
      step: session.daily.step,
      planId: session.daily.planId,
      sessionId: session.sessionId,
    }),
  });
}

async function expectGameError(promise, message, status = 400) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.message, message);
    assert.equal(error.status, status);
    return true;
  });
}

function solveDailySession(h, session, player = PLAYER) {
  assertNoTimingFields(session);
  const stored = h.store.getSession(session.sessionId);
  const pairs = new Map();
  stored.deck.forEach((item, index) => pairs.set(item, [...(pairs.get(item) ?? []), index]));
  const entries = [...pairs.entries()];
  if (session.objective.kind === 'seek') {
    const featured = new Set(session.objective.featured);
    entries.sort(([a], [b]) => Number(featured.has(b)) - Number(featured.has(a)));
  }

  h.advance(5000);
  let last;
  for (const [, [a, b]] of entries) {
    const first = h.game.dailyFlip({ address: player.address, sessionId: session.sessionId, index: a });
    last = h.game.dailyFlip({ address: player.address, sessionId: session.sessionId, index: b });
    assertNoTimingFields(first);
    assertNoTimingFields(last);
    if (last.solved) break;
  }
  assert.equal(last.solved, true);
  return { session, stored, last };
}

async function completeSolved(h, solved, player = PLAYER) {
  const input = {
    address: player.address,
    sessionId: solved.session.sessionId,
    signature: await dailySignature(solved.session, player),
  };
  const result = await h.game.dailyComplete(input);
  assertNoTimingFields(result);
  return { ...solved, input, result };
}

async function completeDailyStep(h, step, player = PLAYER) {
  const session = h.game.dailyStart(player.address, step);
  return completeSolved(h, solveDailySession(h, session, player), player);
}

test('UTC daily plans are deterministic and define three untimed reward steps', () => {
  const day = Date.UTC(2026, 10, 17);
  const plan = dailyPlan(day + 60 * 60 * 1000);
  assert.equal(plan.date, '2026-11-17');
  assert.equal(utcDay(day + 23 * 60 * 60 * 1000), '2026-11-17');
  assert.deepEqual(dailyPlan(day + 23 * 60 * 60 * 1000), plan);
  assert.notDeepEqual(dailyPlan(day + 24 * 60 * 60 * 1000), plan);
  assert.deepEqual(plan.steps.map((step) => step.position), [1, 2, 3]);
  assert.deepEqual(plan.steps.map((step) => step.reward), DAILY_STEP_REWARDS);
  assert.equal(DAILY_STEP_REWARDS.reduce((sum, reward) => sum + reward, 0) + DAILY_COMPLETION_REWARD, DAILY_TOTAL_REWARD);
  assert.equal(DAILY_TOTAL_REWARD, 50);
  assert.equal(plan.steps[1].kind, 'seek');
  assert.equal(plan.steps[1].requiredPairs, 2);
  assert.equal(plan.steps[1].featured.length, 2);
  assertNoTimingFields(plan);
});

test('daily steps unlock sequentially and seek decks contain both featured pairs', async () => {
  const h = harness();
  const initial = h.game.daily(PLAYER.address);
  assert.deepEqual(initial.steps.map((step) => step.status), ['current', 'locked', 'locked']);
  assert.throws(() => h.game.dailyStart(PLAYER.address, 2), /Complete the previous daily step first/);
  assert.throws(() => h.game.dailyStart(PLAYER.address, 3), /Complete the previous daily step first/);

  const first = await completeDailyStep(h, 1);
  assert.deepEqual(first.result.daily.steps.map((step) => step.status), ['claimed', 'current', 'locked']);
  const secondSession = h.game.dailyStart(PLAYER.address, 2);
  assert.equal(secondSession.objective.kind, 'seek');
  assert.equal(secondSession.cardCount, 10);
  const { deck } = h.store.getSession(secondSession.sessionId);
  for (const featured of secondSession.objective.featured) {
    assert.equal(deck.filter((item) => item === featured).length, 2);
  }
  const secondSolved = solveDailySession(h, secondSession);
  assert.equal(secondSolved.last.solved, true);
  assert.equal(secondSolved.last.matchedIndexes.length, 4);
  assert.deepEqual(secondSolved.last.objectiveProgress, {
    kind: 'seek',
    current: 2,
    required: 2,
    featured: secondSession.objective.featured,
  });
  assert.throws(() => h.game.dailyStart(PLAYER.address, 3), /Complete the previous daily step first/);
  const second = await completeSolved(h, secondSolved);
  assert.deepEqual(second.result.daily.steps.map((step) => step.status), ['claimed', 'claimed', 'current']);
  const third = await completeDailyStep(h, 3);
  assert.deepEqual(third.result.daily.steps.map((step) => step.status), ['claimed', 'claimed', 'claimed']);
});

test('each wallet earns exactly 50 local SUMO per day without vouchers or nonces', async () => {
  const h = harness();
  for (const player of [PLAYER, OTHER]) {
    const results = [];
    for (const step of [1, 2, 3]) results.push((await completeDailyStep(h, step, player)).result);
    assert.deepEqual(results.map((result) => result.stepReward), [5, 10, 15]);
    assert.deepEqual(results.map((result) => result.completionReward), [0, 0, 20]);
    assert.deepEqual(results.map((result) => result.localReward), [5, 10, 35]);
    assert.deepEqual(results.map((result) => result.localBalance), [5, 15, 50]);
    for (const result of results) {
      assert.equal('voucher' in result, false);
      assert.equal('reward' in result, false);
    }
    const view = h.game.daily(player.address);
    assert.equal(view.claimedTotal, 50);
    assert.equal(view.localBalance, 50);
    assert.equal(view.completed, true);
  }
  assert.equal(h.game.daily(PLAYER.address).localBalance, 50);
  assert.equal(h.game.daily(OTHER.address).localBalance, 50);
  assert.deepEqual(h.nonceCalls, []);
  assert.deepEqual(h.claimSignatures, []);
});

test('daily signatures are distinct and completions retain their plan across UTC rollover', async () => {
  const h = harness({ now: Date.UTC(2026, 8, 30, 23, 59, 58) });
  const before = h.game.daily(PLAYER.address);
  const session = h.game.dailyStart(PLAYER.address, 1);
  const solved = solveDailySession(h, session);
  assert.equal(solved.session.daily.date, '2026-09-30');
  assert.equal(h.game.daily(PLAYER.address).date, '2026-10-01');

  const dailyText = dailyClearMessage({
    address: PLAYER.address,
    date: session.daily.date,
    step: session.daily.step,
    planId: session.daily.planId,
    sessionId: session.sessionId,
  });
  const chapterText = stageClearMessage({ address: PLAYER.address, stageId: 1, sessionId: session.sessionId });
  assert.notEqual(dailyText, chapterText);
  assert.match(dailyText, /Guardian Match daily clear/);
  assert.match(dailyText, /Date: 2026-09-30/);
  assert.match(dailyText, new RegExp(`Plan: ${session.daily.planId}`));
  const chapterSignature = await PLAYER.signMessage({ message: chapterText });
  await expectGameError(h.game.dailyComplete({
    address: PLAYER.address,
    sessionId: session.sessionId,
    signature: chapterSignature,
  }), 'The daily-clear signature does not match this wallet.', 401);

  const completed = await completeSolved(h, solved);
  assert.equal(completed.result.daily.date, before.date);
  assert.equal(completed.result.daily.planId, before.planId);
  assert.equal(completed.result.daily.name, before.name);
  assert.equal(completed.result.localReward, 5);
  assert.equal(h.store.hasDailyStep(PLAYER.address, '2026-09-30', 1), true);
  assert.equal(h.store.hasDailyStep(PLAYER.address, '2026-10-01', 1), false);
  assert.equal(h.game.daily(PLAYER.address).claimedTotal, 0);
});

test('daily completion is idempotent under retries and concurrency, including the final bonus', async () => {
  const h = harness();
  const firstSession = h.game.dailyStart(PLAYER.address, 1);
  const firstSolved = solveDailySession(h, firstSession);
  const firstInput = {
    address: PLAYER.address,
    sessionId: firstSession.sessionId,
    signature: await dailySignature(firstSession),
  };
  const firstResults = await Promise.all(Array.from({ length: 5 }, () => h.game.dailyComplete(firstInput)));
  assert.equal(firstResults.filter((result) => result.localReward === 5).length, 1);
  assert.equal(firstResults.reduce((sum, result) => sum + result.localReward, 0), 5);
  assert.ok(firstResults.every((result) => result.localBalance === 5));
  const retry = await h.game.dailyComplete(firstInput);
  assert.equal(retry.localReward, 0);
  assert.equal(retry.localBalance, 5);
  assert.equal(h.game.daily(PLAYER.address).claimedTotal, 5);

  await completeDailyStep(h, 2);
  const finalSession = h.game.dailyStart(PLAYER.address, 3);
  const finalSolved = solveDailySession(h, finalSession);
  const finalInput = {
    address: PLAYER.address,
    sessionId: finalSession.sessionId,
    signature: await dailySignature(finalSession),
  };
  const finalResults = await Promise.all(Array.from({ length: 5 }, () => h.game.dailyComplete(finalInput)));
  assert.equal(finalResults.reduce((sum, result) => sum + result.stepReward, 0), 15);
  assert.equal(finalResults.reduce((sum, result) => sum + result.completionReward, 0), 20);
  assert.equal(finalResults.reduce((sum, result) => sum + result.localReward, 0), 35);
  assert.ok(finalResults.every((result) => result.localBalance === 50));
  assert.equal(h.game.daily(PLAYER.address).claimedTotal, 50);
  assert.equal(h.game.daily(PLAYER.address).localBalance, 50);
  assert.deepEqual(h.nonceCalls, []);
  assert.deepEqual(h.claimSignatures, []);
});
