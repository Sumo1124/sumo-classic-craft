// Deterministic, untimed daily adventures. The date selects shared objectives;
// the game engine still securely shuffles a different deck for every attempt.
import { createHash } from 'node:crypto';

export const DAILY_STEP_REWARDS = [5, 10, 15];
export const DAILY_COMPLETION_REWARD = 20;
export const DAILY_TOTAL_REWARD = 50;

const REALMS = [
  { name: 'Carrick Vale', itemIndex: 0 },
  { name: 'Whispering Marsh', itemIndex: 1 },
  { name: 'Emberpeak', itemIndex: 2 },
  { name: 'Far Rift', itemIndex: 3 },
  { name: 'Goldcrest Harbor', itemIndex: 4 },
  { name: 'Nine Holds', itemIndex: 5 },
  { name: 'Frostveil', itemIndex: 6 },
  { name: 'Palmreach', itemIndex: 7 },
];

export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function dailyPlan(now = Date.now()) {
  const date = utcDay(now);
  const hash = createHash('sha256').update(`sumo-daily-v1:${date}`).digest();
  const realm = REALMS[hash[0] % REALMS.length];
  const second = REALMS[(hash[1] + 3) % REALMS.length];
  const third = REALMS[(hash[2] + 5) % REALMS.length];
  const featured = [...new Set([second.itemIndex, third.itemIndex])];
  if (featured.length < 2) featured.push((featured[0] + 1) % REALMS.length);
  const variant = hash[3] % 3;
  const planId = `guardian-trail-${variant + 1}`;

  return {
    id: planId,
    date,
    name: [`The Guardian's Trail`, 'Echoes of Carrickcraft', 'The Realm Restoration'][variant],
    steps: [
      {
        position: 1,
        kind: 'clear',
        name: `${realm.name} Trail`,
        description: 'Clear every pair to open the daily path.',
        pairs: hash[4] % 2 === 0 ? 3 : 4,
        requiredPairs: hash[4] % 2 === 0 ? 3 : 4,
        featured: [],
        itemIndex: realm.itemIndex,
        reward: DAILY_STEP_REWARDS[0],
      },
      {
        position: 2,
        kind: 'seek',
        name: 'Guardian Echoes',
        description: 'Find both featured guardian pairs within the larger board.',
        pairs: 5,
        requiredPairs: 2,
        featured,
        itemIndex: featured[0],
        reward: DAILY_STEP_REWARDS[1],
      },
      {
        position: 3,
        kind: 'restore',
        name: `${third.name} Restoration`,
        description: 'Restore the final sanctuary by clearing all six pairs.',
        pairs: 6,
        requiredPairs: 6,
        featured: [],
        itemIndex: third.itemIndex,
        reward: DAILY_STEP_REWARDS[2],
      },
    ],
  };
}

export function dailyClearMessage({ address, date, step, planId, sessionId }) {
  return [
    'Sumo Classic Craft: World of CarrickCraft — Guardian Match daily clear',
    `Address: ${address.toLowerCase()}`,
    `Date: ${date}`,
    `Step: ${Number(step)}`,
    `Plan: ${planId}`,
    `Session: ${sessionId}`,
  ].join('\n');
}
