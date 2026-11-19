// ClaudeCraft combat math, ported from:
//   src/sim/combat/effect_dispatch.ts (damage, crit)
//   src/sim/mob_combat.ts + combat/engaged_combat.ts (miss, armor)
// Client-side mirror of the server helpers in app/backend/adventure.mjs.

const ABOVE_LEVEL_MISS_PCT = [0, 2.5, 8, 14];

export function aboveLevelMissPct(diff: number): number {
  return ABOVE_LEVEL_MISS_PCT[Math.min(ABOVE_LEVEL_MISS_PCT.length - 1, Math.max(0, diff))];
}

export function meleeMissChance(attackerLevel: number, targetLevel: number): number {
  const diff = targetLevel - attackerLevel;
  const miss = diff > 0 ? 5 + aboveLevelMissPct(diff) : 5 + diff * 0.2;
  return Math.min(0.95, Math.max(0.005, miss / 100));
}

export function spellHitChance(attackerLevel: number, targetLevel: number): number {
  const diff = targetLevel - attackerLevel;
  const hit = diff <= 0 ? 96 - diff : 96 - aboveLevelMissPct(diff);
  return Math.min(0.99, Math.max(0.05, hit / 100));
}

export function armorReduction(armor: number, attackerLevel: number): number {
  const value = Math.max(0, armor);
  return Math.min(0.75, value / (value + 85 * Math.max(1, attackerLevel) + 400));
}

export function mobArmorReduction(armor: number, mobLevel: number, playerLevel: number): number {
  const dr = armorReduction(armor, mobLevel);
  return mobLevel < playerLevel ? Math.min(dr, 0.2) : dr;
}

export function swingMissChance(attackerLevel: number, targetLevel: number, attackerIsMob: boolean): number {
  const miss = meleeMissChance(attackerLevel, targetLevel);
  return attackerIsMob ? Math.min(0.2, miss) : miss;
}

export function rollDamage(
  base: number,
  critChance: number,
  critMultiplier: number,
  reduction: number,
): { dealt: number; crit: boolean } {
  const crit = Math.random() < critChance;
  const raw = crit ? base * critMultiplier : base;
  return { dealt: Math.max(1, Math.round(raw * (1 - reduction))), crit };
}
