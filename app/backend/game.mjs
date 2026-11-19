// Guardian Match: the server owns every deck, flip, objective and reward.
// Chapter clears retain Sepolia vouchers; daily adventures use local SUMO only.
import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'viem';
import {
  DAILY_COMPLETION_REWARD,
  DAILY_STEP_REWARDS,
  DAILY_TOTAL_REWARD,
  dailyClearMessage,
  dailyPlan,
} from './daily.mjs';

export const STAGES = [
  { id: 1, name: 'Carrick Vale', pairs: 3, reward: 25 },
  { id: 2, name: 'Whispering Marsh', pairs: 4, reward: 50 },
  { id: 3, name: 'Emberpeak Ascent', pairs: 6, reward: 100 },
  { id: 4, name: 'Far Rift Crossing', pairs: 8, reward: 150 },
  { id: 5, name: 'Goldcrest Harbor Voyage', pairs: 8, reward: 200 },
  { id: 6, name: 'Nine Holds Finale', pairs: 8, reward: 300 },
];

export const GUARDIANS = [
  {
    id: 'carrick-vale',
    name: 'Carrick Vale',
    title: 'The Pathfinder',
    skillName: 'Guiding Light',
    skillDescription: 'Begin each encounter with one matching pair revealed.',
    itemIndex: 0,
  },
  {
    id: 'whispering-marsh',
    name: 'Whispering Marsh',
    title: 'The Gentle Guardian',
    skillName: 'Gentle Echo',
    skillDescription: 'Your first mismatch does not count as a scored move.',
    itemIndex: 1,
  },
  {
    id: 'emberpeak',
    name: 'Emberpeak',
    title: 'The Flame Keeper',
    skillName: 'Ember Insight',
    skillDescription: 'Your first mismatch reveals the mate of one flipped card.',
    itemIndex: 2,
  },
];

export function stageById(id) {
  return STAGES.find((stage) => stage.id === Number(id)) ?? null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deal distinct items, duplicated and shuffled: deck[i] = item index. */
export function dealDeck(pairs, itemCount, seed, requiredItems = []) {
  const random = mulberry32(seed);
  const chosen = new Set(requiredItems);
  if (chosen.size > pairs || [...chosen].some((item) => !Number.isInteger(item) || item < 0 || item >= itemCount)) {
    throw new Error('Required daily guardians do not fit this deck.');
  }
  while (chosen.size < pairs) chosen.add(Math.floor(random() * itemCount));
  const deck = [...chosen, ...chosen];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function stageClearMessage({ address, stageId, sessionId }) {
  return [
    'Sumo Classic Craft: World of CarrickCraft — Guardian Match stage clear',
    `Address: ${address.toLowerCase()}`,
    `Stage: ${Number(stageId)}`,
    `Session: ${sessionId}`,
  ].join('\n');
}

export function createGame({ store, claimSigner, nextNonce, itemCount = 8, now = () => Date.now() }) {
  const pendingRewards = new Set();

  function validateAddress(address) {
    if (!ADDRESS.test(address ?? '')) throw new GameError('A valid wallet address is required.');
  }

  function guardianById(id) {
    if (id === undefined || id === null || id === '') return GUARDIANS[0];
    const guardian = GUARDIANS.find((entry) => entry.id === id);
    if (!guardian) throw new GameError('Unknown guardian.', 404);
    return guardian;
  }

  function findSession(address, sessionId) {
    validateAddress(address);
    const session = store.getSession(sessionId);
    if (!session || session.address !== address.toLowerCase()) {
      throw new GameError('Session not found for this address.', 404);
    }
    return session;
  }

  function findChapterSession(address, stageId, sessionId) {
    const stage = stageById(stageId);
    if (!stage) throw new GameError('Unknown stage.', 404);
    const session = findSession(address, sessionId);
    if ((session.mode && session.mode !== 'chapter') || session.stageId !== stage.id) {
      throw new GameError('Session not found for this address and stage.', 404);
    }
    return { stage, session };
  }

  function openingHint(session) {
    if (session.guardianId !== 'carrick-vale') return null;
    const seen = new Map();
    for (let index = 0; index < session.deck.length; index += 1) {
      const itemIndex = session.deck[index];
      if (seen.has(itemIndex)) {
        return { kind: 'pair', indexes: [seen.get(itemIndex), index], itemIndex };
      }
      seen.set(itemIndex, index);
    }
    return null;
  }

  function publicSession(session) {
    const guardian = GUARDIANS.find((entry) => entry.id === session.guardianId) ?? null;
    const payload = {
      sessionId: session.id,
      mode: session.mode ?? 'chapter',
      cardCount: session.deck.length,
      guardian,
      hint: openingHint(session),
    };
    if (session.mode === 'daily') {
      payload.daily = {
        date: session.dailyDate,
        planId: session.planId,
        name: session.planSnapshot.name,
        step: session.step,
      };
      payload.objective = session.objective;
    } else {
      payload.stage = stageById(session.stageId);
    }
    return payload;
  }

  function createSession({ address, guardianId, stage = null, plan = null, step = null }) {
    const guardian = guardianById(guardianId);
    const blueprint = stage ?? step;
    const featured = step?.featured ?? [];
    const deck = dealDeck(blueprint.pairs, itemCount, randomBytes(4).readUInt32BE(0), featured);
    const session = {
      id: randomBytes(16).toString('hex'),
      address: address.toLowerCase(),
      mode: plan ? 'daily' : 'chapter',
      stageId: stage?.id ?? null,
      dailyDate: plan?.date ?? null,
      planId: plan?.id ?? null,
      planSnapshot: plan,
      step: step?.position ?? null,
      objective: step,
      requiredPairs: blueprint.requiredPairs ?? blueprint.pairs,
      featured,
      guardianId: guardian.id,
      skillUsed: false,
      deck,
      flipped: [],
      matched: [],
      moves: 0,
      startedAt: now(),
      solvedAt: null,
      completed: false,
    };
    store.saveSession(session);
    return publicSession(session);
  }

  function objectiveProgress(session) {
    if (session.mode === 'daily' && session.objective.kind === 'seek') {
      const current = session.featured.filter((itemIndex) => {
        const indexes = session.deck
          .map((entry, index) => entry === itemIndex ? index : -1)
          .filter((index) => index >= 0);
        return indexes.length === 2 && indexes.every((index) => session.matched.includes(index));
      }).length;
      return { kind: 'seek', current, required: session.requiredPairs, featured: [...session.featured] };
    }
    return {
      kind: session.objective?.kind ?? 'clear',
      current: session.matched.length / 2,
      required: session.requiredPairs ?? session.deck.length / 2,
      featured: [...(session.featured ?? [])],
    };
  }

  function flipSession(session, index) {
    if (session.completed) throw new GameError('This session was already submitted.', 409);
    if (session.solvedAt !== null) throw new GameError('This encounter is already solved.', 409);
    if (session.flipped.length === 2) session.flipped = [];
    if (!Number.isInteger(index) || index < 0 || index >= session.deck.length) {
      throw new GameError('Card index is outside the deck.');
    }
    if (session.matched.includes(index) || session.flipped.includes(index)) {
      throw new GameError('This card cannot be flipped again.', 409);
    }

    session.flipped.push(index);
    let matched = false;
    let hint = null;
    let skillTriggered = false;
    if (session.flipped.length === 2) {
      const [a, b] = session.flipped;
      matched = session.deck[a] === session.deck[b];
      if (matched) {
        session.moves += 1;
        session.matched.push(a, b);
        session.flipped = [];
      } else if (session.guardianId === 'whispering-marsh' && !session.skillUsed) {
        session.skillUsed = true;
        skillTriggered = true;
      } else {
        session.moves += 1;
      }

      if (!matched && session.guardianId === 'emberpeak' && !session.skillUsed) {
        const mate = session.deck.findIndex((itemIndex, cardIndex) => itemIndex === session.deck[a] && cardIndex !== a);
        session.skillUsed = true;
        skillTriggered = true;
        hint = { kind: 'mate', sourceIndex: a, indexes: [mate], itemIndex: session.deck[a] };
      }
      const progress = objectiveProgress(session);
      if (progress.current >= progress.required) session.solvedAt = now();
    }
    store.saveSession(session);
    return {
      ok: true,
      index,
      itemIndex: session.deck[index],
      moves: session.moves,
      matched,
      matchedIndexes: [...session.matched],
      objectiveProgress: objectiveProgress(session),
      hint,
      skillTriggered,
      solved: session.solvedAt !== null,
    };
  }

  function assertPlausibleClear(session, requiredPairs) {
    if (session.solvedAt === null) throw new GameError('The encounter is not solved yet.', 409);
    const durationMs = session.solvedAt - session.startedAt;
    if (!Number.isFinite(durationMs) || durationMs < requiredPairs * 500) {
      throw new GameError('The clear time is outside the plausible range.');
    }
  }

  function dailyView(address, plan) {
    const ledger = store.dailyProgress(address, plan.date);
    const next = plan.steps.find((step) => !Object.hasOwn(ledger.steps, String(step.position)));
    return {
      date: plan.date,
      planId: plan.id,
      name: plan.name,
      totalReward: DAILY_TOTAL_REWARD,
      completionReward: DAILY_COMPLETION_REWARD,
      claimedTotal: ledger.claimedTotal,
      completed: ledger.completed,
      localBalance: store.progress(address).localBalance,
      steps: plan.steps.map((step) => {
        const claimed = Object.hasOwn(ledger.steps, String(step.position));
        return {
          ...step,
          status: claimed ? 'claimed' : next?.position === step.position ? 'current' : 'locked',
        };
      }),
    };
  }

  return {
    stages(address) {
      const progress = ADDRESS.test(address ?? '') ? store.progress(address) : { earned: [], best: {}, localBalance: 0 };
      return { stages: STAGES, guardians: GUARDIANS, progress };
    },

    start(address, stageId, guardianId) {
      validateAddress(address);
      const stage = stageById(stageId);
      if (!stage) throw new GameError('Unknown stage.', 404);
      return createSession({ address, stage, guardianId });
    },

    flip({ address, stageId, sessionId, index }) {
      const { session } = findChapterSession(address, stageId, sessionId);
      return flipSession(session, index);
    },

    daily(address) {
      validateAddress(address);
      return dailyView(address, dailyPlan(now()));
    },

    dailyStart(address, stepPosition, guardianId) {
      validateAddress(address);
      const plan = dailyPlan(now());
      const step = plan.steps.find((entry) => entry.position === Number(stepPosition));
      if (!step) throw new GameError('Unknown daily step.', 404);
      if (step.position > 1 && !store.hasDailyStep(address, plan.date, step.position - 1)) {
        throw new GameError('Complete the previous daily step first.', 409);
      }
      return createSession({ address, plan, step, guardianId });
    },

    dailyFlip({ address, sessionId, index }) {
      const session = findSession(address, sessionId);
      if (session.mode !== 'daily') throw new GameError('Daily session not found.', 404);
      return flipSession(session, index);
    },

    async dailyComplete({ address, sessionId, signature }) {
      const session = findSession(address, sessionId);
      if (session.mode !== 'daily') throw new GameError('Daily session not found.', 404);
      assertPlausibleClear(session, session.requiredPairs);
      if (session.step > 1 && !store.hasDailyStep(session.address, session.dailyDate, session.step - 1)) {
        throw new GameError('Complete the previous daily step first.', 409);
      }

      let ownsAddress = false;
      try {
        ownsAddress = await verifyMessage({
          address: session.address,
          message: dailyClearMessage({
            address: session.address,
            date: session.dailyDate,
            step: session.step,
            planId: session.planId,
            sessionId,
          }),
          signature,
        });
      } catch {
        throw new GameError('A valid daily-clear signature is required.', 400);
      }
      if (!ownsAddress) throw new GameError('The daily-clear signature does not match this wallet.', 401);

      const award = store.awardDaily(
        session.address,
        session.dailyDate,
        session.step,
        DAILY_STEP_REWARDS[session.step - 1],
        DAILY_COMPLETION_REWARD,
      );
      session.completed = true;
      store.saveSession(session);
      const localReward = award.stepReward + award.completionReward;
      return {
        ok: true,
        mode: 'daily',
        step: session.step,
        moves: session.moves,
        localReward,
        stepReward: award.stepReward,
        completionReward: award.completionReward,
        localBalance: award.localBalance,
        daily: dailyView(session.address, session.planSnapshot),
        message: localReward > 0
          ? `Daily step complete! ${localReward} local SUMO added${award.completionReward ? ', including the trail completion bonus' : ''}.`
          : 'Daily step complete. Its local SUMO reward was already collected.',
      };
    },

    /** Verify a chapter clear and preserve its independent Sepolia eligibility. */
    async complete({ address, stageId, sessionId, signature }) {
      const { stage, session } = findChapterSession(address, stageId, sessionId);
      assertPlausibleClear(session, stage.pairs);

      let ownsAddress = false;
      try {
        ownsAddress = await verifyMessage({
          address: session.address,
          message: stageClearMessage({ address: session.address, stageId: stage.id, sessionId }),
          signature,
        });
      } catch {
        throw new GameError('A valid stage-clear signature is required.', 400);
      }
      if (!ownsAddress) throw new GameError('The stage-clear signature does not match this wallet.', 401);

      const finish = () => {
        session.completed = true;
        store.saveSession(session);
        store.setBest(session.address, stage.id, { moves: session.moves });
      };
      const awardLocal = () => {
        const firstClear = !store.hasLocalEarned(session.address, stage.id);
        if (firstClear) store.setLocalEarned(session.address, stage.id, stage.reward);
        return {
          localReward: firstClear ? stage.reward : 0,
          localBalance: store.progress(session.address).localBalance,
        };
      };

      const existing = store.getVoucher(session.address, stage.id);
      if (store.hasEarned(session.address, stage.id)) {
        const local = awardLocal();
        finish();
        return {
          ok: true,
          stage: stage.id,
          moves: session.moves,
          reward: existing ? stage.reward : 0,
          ...local,
          voucher: existing,
          message: existing
            ? 'Stage cleared again. Your original SUMO reward voucher is ready.'
            : 'Stage cleared again. This stage reward was already earned.',
        };
      }

      const local = awardLocal();
      const rewardKey = `${session.address}:${stage.id}`;
      if (pendingRewards.has(rewardKey)) {
        throw new GameError('Reward signing is already in progress for this stage.', 409);
      }
      if (!claimSigner) {
        finish();
        return {
          ok: true,
          stage: stage.id,
          moves: session.moves,
          reward: 0,
          ...local,
          voucher: null,
          message: local.localReward > 0
            ? `Stage clear! ${local.localReward} game SUMO added. Your future Sepolia claim remains eligible.`
            : 'Stage cleared again. Your game SUMO was already collected; the Sepolia claim remains eligible.',
        };
      }

      pendingRewards.add(rewardKey);
      try {
        const amount = BigInt(stage.reward) * 10n ** 18n;
        const nonce = await nextNonce(session.address);
        const signed = await claimSigner.signClaim({ to: session.address, amount, nonce });
        const voucher = {
          chainId: claimSigner.chainId,
          verifyingContract: claimSigner.verifyingContract,
          to: session.address,
          amount: amount.toString(),
          nonce: nonce.toString(),
          signature: signed.signature,
        };
        store.setEarned(session.address, stage.id, voucher);
        finish();
        return {
          ok: true,
          stage: stage.id,
          moves: session.moves,
          reward: stage.reward,
          ...local,
          voucher,
          message: local.localReward > 0
            ? `Stage clear! ${local.localReward} game SUMO added and your Sepolia voucher was signed.`
            : 'Stage clear! Your Sepolia SUMO voucher is ready; game coins were already collected.',
        };
      } finally {
        pendingRewards.delete(rewardKey);
      }
    },
  };
}
