// File-backed persistence for claim nonces and Guardian Match. Writes use a
// temporary file plus rename, and corrupt existing files stop startup instead
// of silently reopening rewards or reusing nonces.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, filePath);
}

export function createClaimStore(filePath) {
  let nonces = {};
  if (existsSync(filePath)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Claim store is corrupt: ${filePath}`, { cause: error });
    }
    if (!parsed || typeof parsed.nonces !== 'object' || parsed.nonces === null) {
      throw new Error(`Claim store is invalid: ${filePath}`);
    }
    nonces = { ...parsed.nonces };
  }

  function save() {
    writeJson(filePath, { nonces });
  }

  return {
    /** Allocate and persist the next nonce for an address. */
    nextNonce(address) {
      const key = address.toLowerCase();
      const nonce = Number(nonces[key] ?? 0) + 1;
      if (!Number.isSafeInteger(nonce)) throw new Error('Claim nonce exceeds the safe integer range.');
      nonces[key] = nonce;
      save();
      return BigInt(nonce);
    },
    /** Last allocated nonce without advancing the counter. */
    peek(address) {
      return BigInt(Number(nonces[address.toLowerCase()] ?? 0));
    },
  };
}

/** Game persistence: sessions, local rewards, Sepolia vouchers and best moves. */
export function createGameStore(filePath) {
  let data = { sessions: {}, earned: {}, localEarned: {}, dailyEarned: {}, best: {}, adventure: {} };
  if (existsSync(filePath)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Game store is corrupt: ${filePath}`, { cause: error });
    }
    if (!parsed || typeof parsed !== 'object') throw new Error(`Game store is invalid: ${filePath}`);
    const dailyEarned = parsed.dailyEarned ?? {};
    if (!dailyEarned || typeof dailyEarned !== 'object' || Array.isArray(dailyEarned)) {
      throw new Error(`Game store has an invalid daily reward ledger: ${filePath}`);
    }
    for (const entry of Object.values(dailyEarned)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          !entry.steps || typeof entry.steps !== 'object' || Array.isArray(entry.steps) ||
          Object.values(entry.steps).some((reward) => !Number.isFinite(reward) || reward < 0) ||
          !Number.isFinite(entry.completion ?? 0) || Number(entry.completion ?? 0) < 0) {
        throw new Error(`Game store has an invalid daily reward ledger: ${filePath}`);
      }
    }
    data = {
      sessions: parsed.sessions ?? {},
      earned: parsed.earned ?? {},
      localEarned: parsed.localEarned ?? {},
      dailyEarned,
      best: parsed.best ?? {},
      adventure: parsed.adventure ?? {},
    };
  }

  function save() {
    writeJson(filePath, data);
  }

  const key = (address, stageId) => `${address.toLowerCase()}:${Number(stageId)}`;
  const dailyKey = (address, date) => `${address.toLowerCase()}:${date}`;

  function dailyProgress(address, date) {
    const entry = data.dailyEarned[dailyKey(address, date)] ?? { steps: {}, completion: 0 };
    const steps = { ...entry.steps };
    const completion = Number(entry.completion ?? 0);
    const claimedTotal = Object.values(steps).reduce((sum, reward) => sum + Number(reward), 0) + completion;
    return { steps, completion, claimedTotal, completed: completion > 0 };
  }

  function progress(address) {
    const prefix = `${address.toLowerCase()}:`;
    const earned = [];
    const best = {};
    let localBalance = 0;
    for (const [k, reward] of Object.entries(data.localEarned)) {
      if (!k.startsWith(prefix)) continue;
      earned.push(Number(k.slice(prefix.length)));
      localBalance += Number(reward);
    }
    for (const [k, entry] of Object.entries(data.dailyEarned)) {
      if (!k.startsWith(prefix)) continue;
      localBalance += Object.values(entry.steps).reduce((sum, reward) => sum + Number(reward), 0);
      localBalance += Number(entry.completion ?? 0);
    }
    const adventure = data.adventure[address.toLowerCase()];
    if (adventure) localBalance += Number(adventure.sumoEarned ?? 0);
    for (const [k, score] of Object.entries(data.best)) {
      if (k.startsWith(prefix)) best[Number(k.slice(prefix.length))] = score;
    }
    return { earned: earned.sort((a, b) => a - b), best, localBalance };
  }

  return {
    saveSession(session) {
      // Untimed sessions stay resumable. Only completed history is age-pruned.
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const [id, entry] of Object.entries(data.sessions)) {
        if (entry.completed && entry.startedAt < cutoff) delete data.sessions[id];
      }
      const all = Object.entries(data.sessions).sort((a, b) => a[1].startedAt - b[1].startedAt);
      while (all.length >= 1000) {
        const [id] = all.shift();
        delete data.sessions[id];
      }
      const own = Object.entries(data.sessions)
        .filter(([, entry]) => entry.address === session.address)
        .sort((a, b) => a[1].startedAt - b[1].startedAt);
      while (own.length >= 12) {
        const [id] = own.shift();
        delete data.sessions[id];
      }
      data.sessions[session.id] = session;
      save();
    },
    getSession(id) {
      return data.sessions[id] ?? null;
    },
    hasEarned(address, stageId) {
      return Boolean(data.earned[key(address, stageId)]);
    },
    getVoucher(address, stageId) {
      const value = data.earned[key(address, stageId)];
      return value && typeof value === 'object' && value.signature ? value : null;
    },
    setEarned(address, stageId, voucher) {
      data.earned[key(address, stageId)] = voucher;
      save();
    },
    hasLocalEarned(address, stageId) {
      return Object.hasOwn(data.localEarned, key(address, stageId));
    },
    setLocalEarned(address, stageId, reward) {
      data.localEarned[key(address, stageId)] = reward;
      save();
    },
    hasDailyStep(address, date, step) {
      const entry = data.dailyEarned[dailyKey(address, date)];
      return Boolean(entry && Object.hasOwn(entry.steps, String(Number(step))));
    },
    dailyProgress,
    awardDaily(address, date, step, reward, completionReward) {
      const k = dailyKey(address, date);
      const current = data.dailyEarned[k] ?? { steps: {}, completion: 0 };
      const next = { steps: { ...current.steps }, completion: Number(current.completion ?? 0) };
      const stepKey = String(Number(step));
      const stepReward = Object.hasOwn(next.steps, stepKey) ? 0 : reward;
      if (stepReward > 0) next.steps[stepKey] = reward;

      let awardedCompletion = 0;
      if ([1, 2, 3].every((position) => Object.hasOwn(next.steps, String(position))) && next.completion === 0) {
        next.completion = completionReward;
        awardedCompletion = completionReward;
      }
      if (stepReward > 0 || awardedCompletion > 0) {
        data.dailyEarned[k] = next;
        save();
      }
      return {
        stepReward,
        completionReward: awardedCompletion,
        daily: dailyProgress(address, date),
        localBalance: progress(address).localBalance,
      };
    },
    setBest(address, stageId, score) {
      const k = key(address, stageId);
      const previous = data.best[k];
      if (!previous || score.moves < previous.moves) {
        data.best[k] = { moves: score.moves };
        save();
      }
    },
    progress,
    getAdventure(address) {
      return data.adventure[address.toLowerCase()] ?? null;
    },
    saveAdventure(address, entry) {
      data.adventure[address.toLowerCase()] = entry;
      save();
    },
  };
}
