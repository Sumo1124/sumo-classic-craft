// Adventure layer: classic turn-based combat, quests, zones and a homestead,
// all resolved on the server so the client can never invent a reward.
import { randomBytes, randomInt } from 'node:crypto';
import { GameError } from './game.mjs';

export const MAX_LEVEL = 12;

const CONQUEST_BONUS = {
  'eastbrook-vale': 25,
  'mirefen-marsh': 40,
  'thornpeak-heights': 60,
  drakelands: 85,
  willowfen: 110,
};

const ANTAGONIST_LORE = {
  'eastbrook-vale': {
    title: 'The Gravecaller of Eastbrook',
    taunt: 'Every name in the ledger answers when I call it.',
  },
  'mirefen-marsh': {
    title: 'Terror of the Drowned Reeds',
    taunt: 'Every head you cut remembers your name.',
  },
  'thornpeak-heights': {
    title: 'The Bound Ruin',
    taunt: 'Iron could not hold me. You will do worse.',
  },
  drakelands: {
    title: 'The Last Wing of the Ash',
    taunt: 'The grave already knows how you end.',
  },
  willowfen: {
    title: 'Warden of the First Root',
    taunt: 'The fen was mine before your kind had words.',
  },
};

export function xpForLevel(level) {
  return Math.round(90 * level ** 1.45);
}

const ABILITY = (id, name, icon, cost, cooldown, description, effect) => ({
  id, name, icon, cost, cooldown, description, ...effect,
});

export const ABILITIES = {
  // Warrior — rage
  reaver_strike: ABILITY('reaver_strike', 'Reaver Strike', 'impact_metal_1', 15, 0, 'A heavy weapon strike.', { type: 'damage', min: 12, max: 18, school: 'physical', gain: 6 }),
  iron_bellow: ABILITY('iron_bellow', 'Iron Bellow', 'impact_warrior_brute_1', 5, 3, 'Raises your attack by 25% for 3 turns.', { type: 'buff', buff: 'attackPct', value: 0.25, turns: 3 }),
  onrush: ABILITY('onrush', 'Onrush', 'impact_warrior_faultline_2', 0, 3, 'Charges the enemy, stunning it for 1 turn.', { type: 'damage', min: 6, max: 10, school: 'physical', stun: 1 }),
  quaking_blow: ABILITY('quaking_blow', 'Quaking Blow', 'impact_warrior_hammer_land_1', 20, 0, 'Shakes the ground for heavy damage.', { type: 'damage', min: 18, max: 26, school: 'physical' }),
  execute: ABILITY('execute', 'Execute', 'impact_warrior_early_grave_1', 30, 4, 'Deals double damage to wounded enemies.', { type: 'damage', min: 20, max: 28, school: 'physical', execute: true }),

  // Mage — mana
  cinderbolt: ABILITY('cinderbolt', 'Cinderbolt', 'cast_fire', 20, 0, 'Fire damage plus a short burn.', { type: 'damage', min: 14, max: 20, school: 'fire', dot: { total: 9, turns: 2 } }),
  rimelance: ABILITY('rimelance', 'Rimelance', 'cast_frost', 16, 0, 'Frost damage that weakens the enemy.', { type: 'damage', min: 12, max: 17, school: 'frost', weaken: { pct: 0.25, turns: 2 } }),
  aether_insight: ABILITY('aether_insight', 'Aether Insight', 'cast_arcane', 12, 4, 'Raises your spell damage by 30% for 4 turns.', { type: 'buff', buff: 'spellPct', value: 0.3, turns: 4 }),
  frost_nova: ABILITY('frost_nova', 'Frost Nova', 'impact_frost', 22, 3, 'Bursts for frost damage and stuns for 1 turn.', { type: 'damage', min: 10, max: 15, school: 'frost', stun: 1 }),
  arcane_barrier: ABILITY('arcane_barrier', 'Arcane Barrier', 'impact_arcane', 18, 4, 'Absorbs the next 45 damage.', { type: 'shield', amount: 45 }),

  // Rogue — energy
  sinister_strike: ABILITY('sinister_strike', 'Sinister Strike', 'impact_leather_1', 25, 0, 'A quick strike that builds momentum.', { type: 'damage', min: 12, max: 17, school: 'physical', gain: 8 }),
  backstab: ABILITY('backstab', 'Backstab', 'impact_leather_2', 30, 2, 'Strikes a vital point for heavy damage.', { type: 'damage', min: 20, max: 27, school: 'physical' }),
  eviscerate: ABILITY('eviscerate', 'Eviscerate', 'impact_leather_3', 35, 0, 'A finishing flurry.', { type: 'damage', min: 24, max: 32, school: 'physical' }),
  stealth: ABILITY('stealth', 'Shadowcloak', 'cast_shadow', 0, 4, 'Your next attack deals double damage.', { type: 'buff', buff: 'nextAttack', value: 2, turns: 3 }),
  recuperate: ABILITY('recuperate', 'Recuperate', 'heal_impact', 25, 3, 'Recovers 30% of your maximum health.', { type: 'heal', pct: 0.3 }),

  // Priest — mana
  smite: ABILITY('smite', 'Smite', 'cast_holy', 14, 0, 'Holy damage.', { type: 'damage', min: 11, max: 16, school: 'holy' }),
  greater_heal: ABILITY('greater_heal', 'Greater Heal', 'impact_holy', 20, 0, 'Restores 34-42 health.', { type: 'heal', min: 34, max: 42 }),
  shadow_word_pain: ABILITY('shadow_word_pain', 'Shadow Word: Pain', 'cast_shadow', 14, 0, 'Shadow damage over 3 turns.', { type: 'damage', min: 2, max: 4, school: 'shadow', dot: { total: 21, turns: 3 } }),
  power_word_shield: ABILITY('power_word_shield', 'Power Word: Shield', 'impact_holy', 18, 3, 'Absorbs the next 40 damage.', { type: 'shield', amount: 40 }),
  renew: ABILITY('renew', 'Renew', 'cast_nature', 14, 2, 'Heals 18 each turn for 3 turns.', { type: 'hot', total: 54, turns: 3 }),

  // Hunter — focus
  steady_shot: ABILITY('steady_shot', 'Steady Shot', 'impact_flesh_1', 14, 0, 'A measured ranged shot.', { type: 'damage', min: 12, max: 17, school: 'physical' }),
  aimed_shot: ABILITY('aimed_shot', 'Aimed Shot', 'impact_flesh_2', 26, 2, 'A precise shot for heavy damage.', { type: 'damage', min: 22, max: 30, school: 'physical' }),
  serpent_sting: ABILITY('serpent_sting', 'Serpent Sting', 'cast_nature', 16, 0, 'Poisons the enemy for 3 turns.', { type: 'damage', min: 3, max: 5, school: 'nature', dot: { total: 24, turns: 3 } }),
  concussive_shot: ABILITY('concussive_shot', 'Concussive Shot', 'impact_bone_1', 18, 3, 'Stuns the enemy for 1 turn.', { type: 'damage', min: 6, max: 9, school: 'physical', stun: 1 }),
  field_dressing: ABILITY('field_dressing', 'Field Dressing', 'cast_chain_heal', 18, 3, 'Restores 26-32 health.', { type: 'heal', min: 26, max: 32 }),

  // Paladin — mana
  crusader_strike: ABILITY('crusader_strike', 'Crusader Strike', 'impact_metal_2', 12, 0, 'A holy weapon strike.', { type: 'damage', min: 11, max: 16, school: 'holy' }),
  holy_light: ABILITY('holy_light', 'Holy Light', 'cast_holy', 20, 0, 'Restores 32-40 health.', { type: 'heal', min: 32, max: 40 }),
  judgment: ABILITY('judgment', 'Judgment', 'impact_holy', 16, 2, 'Calls down judgment for 15-21 damage.', { type: 'damage', min: 15, max: 21, school: 'holy' }),
  divine_shield: ABILITY('divine_shield', 'Divine Shield', 'cast_holy', 22, 5, 'Absorbs the next 50 damage.', { type: 'shield', amount: 50 }),
  consecration: ABILITY('consecration', 'Consecration', 'impact_holy', 24, 0, 'Holy ground burns the enemy over time.', { type: 'damage', min: 8, max: 12, school: 'holy', dot: { total: 15, turns: 3 } }),

  // Druid — mana
  wrath: ABILITY('wrath', 'Wrath', 'cast_nature', 14, 0, 'A bolt of natural energy.', { type: 'damage', min: 12, max: 17, school: 'nature' }),
  moonfire: ABILITY('moonfire', 'Moonfire', 'cast_arcane', 18, 0, 'Moonfire burns the target for 3 turns.', { type: 'damage', min: 9, max: 13, school: 'nature', dot: { total: 18, turns: 3 } }),
  rejuvenation: ABILITY('rejuvenation', 'Rejuvenation', 'cast_chain_heal', 18, 2, 'Heals 16 each turn for 3 turns.', { type: 'hot', total: 48, turns: 3 }),
  barkskin: ABILITY('barkskin', 'Barkskin', 'impact_nature', 16, 4, 'Bark absorbs the next 42 damage.', { type: 'shield', amount: 42 }),
  starfire: ABILITY('starfire', 'Starfire', 'cast_arcane', 28, 2, 'Calls down a heavy burst of starlight.', { type: 'damage', min: 22, max: 30, school: 'nature' }),

  // Shaman — mana
  lightning_bolt: ABILITY('lightning_bolt', 'Lightning Bolt', 'cast_lightning_bolt', 20, 0, 'A crackling bolt of storm energy.', { type: 'damage', min: 15, max: 21, school: 'nature' }),
  flame_shock: ABILITY('flame_shock', 'Flame Shock', 'cast_fire', 18, 0, 'Scorches the enemy and leaves them burning.', { type: 'damage', min: 8, max: 12, school: 'fire', dot: { total: 18, turns: 3 } }),
  healing_wave: ABILITY('healing_wave', 'Healing Wave', 'cast_chain_heal', 20, 0, 'Restores 30-38 health.', { type: 'heal', min: 30, max: 38 }),
  frost_shock: ABILITY('frost_shock', 'Frost Shock', 'cast_frost', 22, 3, 'Frost damage that stuns for 1 turn.', { type: 'damage', min: 12, max: 17, school: 'frost', stun: 1 }),
  storm_totem: ABILITY('storm_totem', 'Storm Totem', 'impact_nature', 16, 5, 'Raises your spell damage by 30% for 4 turns.', { type: 'buff', buff: 'spellPct', value: 0.3, turns: 4 }),

  // Warlock — mana
  shadow_bolt: ABILITY('shadow_bolt', 'Shadow Bolt', 'cast_shadow', 18, 0, 'Hurls a bolt of shadow.', { type: 'damage', min: 14, max: 19, school: 'shadow' }),
  corruption: ABILITY('corruption', 'Corruption', 'cast_shadow', 16, 0, 'Corrupts the enemy for 3 turns.', { type: 'damage', min: 3, max: 5, school: 'shadow', dot: { total: 21, turns: 3 } }),
  drain_life: ABILITY('drain_life', 'Drain Life', 'cast_shadow', 20, 0, 'Deals shadow damage and heals you for half of it.', { type: 'damage', min: 10, max: 14, school: 'shadow', drain: 0.5 }),
  howl_of_terror: ABILITY('howl_of_terror', 'Howl of Terror', 'cast_shadow', 18, 4, 'Terrifies the enemy, stunning it for 1 turn.', { type: 'stun', turns: 1 }),
  soul_fire: ABILITY('soul_fire', 'Soul Fire', 'cast_fire', 30, 3, 'A slow, devastating ball of soul fire.', { type: 'damage', min: 24, max: 32, school: 'shadow' }),
};

export const CLASSES = [
  {
    id: 'warrior', name: 'Warrior', title: 'Iron Vanguard', resource: 'rage', resourceName: 'Rage',
    baseHp: 132, hpPerLevel: 20, attack: 15, attackPerLevel: 3.4, spell: 0, spellPerLevel: 0,
    armor: 62, armorPerLevel: 7, resourceMax: 100, resourceRegen: 10,
    abilities: ['reaver_strike', 'iron_bellow', 'onrush', 'quaking_blow', 'execute'],
    portrait: '/woc/classes/warrior.webp',
    blurb: 'A relentless front-line fighter who turns every exchange into rage.',
  },
  {
    id: 'mage', name: 'Mage', title: 'Ember Scholar', resource: 'mana', resourceName: 'Mana',
    baseHp: 96, hpPerLevel: 13, attack: 5, attackPerLevel: 0.9, spell: 16, spellPerLevel: 3.2,
    armor: 30, armorPerLevel: 3, resourceMax: 120, resourceRegen: 10,
    abilities: ['cinderbolt', 'rimelance', 'aether_insight', 'frost_nova', 'arcane_barrier'],
    portrait: '/woc/classes/mage.webp',
    blurb: 'Fragile, precise, and capable of burning a foe down in a few casts.',
  },
  {
    id: 'rogue', name: 'Rogue', title: 'Quiet Blade', resource: 'energy', resourceName: 'Energy',
    baseHp: 108, hpPerLevel: 15, attack: 13, attackPerLevel: 3.1, spell: 0, spellPerLevel: 0,
    armor: 40, armorPerLevel: 4, resourceMax: 100, resourceRegen: 20,
    abilities: ['sinister_strike', 'backstab', 'eviscerate', 'stealth', 'recuperate'],
    portrait: '/woc/classes/rogue.webp',
    blurb: 'Strikes fast, disappears faster, and never fights fair.',
  },
  {
    id: 'priest', name: 'Priest', title: 'Dawnkeeper', resource: 'mana', resourceName: 'Mana',
    baseHp: 100, hpPerLevel: 14, attack: 5, attackPerLevel: 0.9, spell: 15, spellPerLevel: 3,
    armor: 32, armorPerLevel: 3, resourceMax: 130, resourceRegen: 11,
    abilities: ['smite', 'greater_heal', 'shadow_word_pain', 'power_word_shield', 'renew'],
    portrait: '/woc/classes/priest.webp',
    blurb: 'Sustains long fights with shields, renews, and steady holy damage.',
  },
  {
    id: 'hunter', name: 'Hunter', title: 'Wildwarden', resource: 'focus', resourceName: 'Focus',
    baseHp: 112, hpPerLevel: 16, attack: 14, attackPerLevel: 3.2, spell: 4, spellPerLevel: 0.8,
    armor: 44, armorPerLevel: 4, resourceMax: 100, resourceRegen: 14,
    abilities: ['steady_shot', 'aimed_shot', 'serpent_sting', 'concussive_shot', 'field_dressing'],
    portrait: '/woc/classes/hunter.webp',
    blurb: 'Controls the pace with stings, stuns, and heavy aimed shots.',
  },
  {
    id: 'paladin', name: 'Paladin', title: 'Oathsworn', resource: 'mana', resourceName: 'Mana',
    baseHp: 124, hpPerLevel: 18, attack: 12, attackPerLevel: 2.7, spell: 13, spellPerLevel: 2.6,
    armor: 58, armorPerLevel: 6, resourceMax: 120, resourceRegen: 9,
    abilities: ['crusader_strike', 'holy_light', 'judgment', 'divine_shield', 'consecration'],
    portrait: '/woc/classes/paladin.webp',
    blurb: 'A durable healer-warrior who outlasts almost anything.',
  },
  {
    id: 'druid', name: 'Druid', title: 'Thornspeaker', resource: 'mana', resourceName: 'Mana',
    baseHp: 106, hpPerLevel: 15, attack: 7, attackPerLevel: 1.3, spell: 15, spellPerLevel: 3.1,
    armor: 38, armorPerLevel: 4, resourceMax: 125, resourceRegen: 11,
    abilities: ['wrath', 'moonfire', 'rejuvenation', 'barkskin', 'starfire'],
    portrait: '/woc/classes/druid.webp',
    blurb: 'Blends steady nature damage with the strongest heal-over-time in the vale.',
  },
  {
    id: 'shaman', name: 'Shaman', title: 'Stormcaller', resource: 'mana', resourceName: 'Mana',
    baseHp: 110, hpPerLevel: 15, attack: 8, attackPerLevel: 1.5, spell: 15, spellPerLevel: 3,
    armor: 42, armorPerLevel: 4, resourceMax: 120, resourceRegen: 11,
    abilities: ['lightning_bolt', 'flame_shock', 'healing_wave', 'frost_shock', 'storm_totem'],
    portrait: '/woc/classes/shaman.webp',
    blurb: 'Calls storms, shocks, and steady heals to control every turn of a fight.',
  },
  {
    id: 'warlock', name: 'Warlock', title: 'Pactbound', resource: 'mana', resourceName: 'Mana',
    baseHp: 98, hpPerLevel: 14, attack: 5, attackPerLevel: 0.9, spell: 17, spellPerLevel: 3.3,
    armor: 32, armorPerLevel: 3, resourceMax: 130, resourceRegen: 12,
    abilities: ['shadow_bolt', 'corruption', 'drain_life', 'howl_of_terror', 'soul_fire'],
    portrait: '/woc/classes/warlock.webp',
    blurb: 'Trades durability for curses, drains, and terrifying burst damage.',
  },
];

const GEAR = (id, name, slot, reqLevel, stats, icon, description) => ({
  id, name, kind: 'gear', slot, reqLevel, stats, icon, description,
});

export const ITEMS = {
  baked_bread: { id: 'baked_bread', name: 'Baked Bread', kind: 'food', icon: '/woc/items/baked_bread.webp', heal: 32, description: 'Restores 32 health.' },
  spring_water: { id: 'spring_water', name: 'Spring Water', kind: 'drink', icon: '/woc/items/spring_water.webp', restore: 30, description: 'Restores 30 resource.' },
  lesser_healing_potion: { id: 'lesser_healing_potion', name: 'Lesser Healing Potion', kind: 'potion', icon: '/woc/items/lesser_healing_potion.webp', heal: 35, description: 'Restores 35 health.' },
  lesser_mana_potion: { id: 'lesser_mana_potion', name: 'Lesser Mana Potion', kind: 'potion', icon: '/woc/items/lesser_mana_potion.webp', restore: 30, description: 'Restores 30 resource.' },
  healing_potion: { id: 'healing_potion', name: 'Healing Potion', kind: 'potion', icon: '/woc/items/healing_potion.webp', heal: 70, description: 'Restores 70 health.' },
  mana_potion: { id: 'mana_potion', name: 'Mana Potion', kind: 'potion', icon: '/woc/items/mana_potion.webp', restore: 60, description: 'Restores 60 resource.' },
  wolf_fang: { id: 'wolf_fang', name: 'Wolf Fang', kind: 'trophy', icon: '/woc/items/wolf_fang.webp', description: 'A trophy from the vale wolves.' },
  boar_hide: { id: 'boar_hide', name: 'Boar Hide', kind: 'trophy', icon: '/woc/items/boar_hide.webp', description: 'Thick hide, useful to the tanners.' },
  copper_ore: { id: 'copper_ore', name: 'Copper Ore', kind: 'trophy', icon: '/woc/items/copper_ore.webp', description: 'Raw copper from the Copper Dig.' },
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', kind: 'trophy', icon: '/woc/items/iron_ore.webp', description: 'Heavy ore from the high peaks.' },
  thorium_ore: { id: 'thorium_ore', name: 'Thorium Ore', kind: 'trophy', icon: '/woc/items/thorium_ore.webp', description: 'A rare ore from the Drakelands.' },

  // Eastbrook Vale quest items (ClaudeCraft zone 1).
  greyjaw_fang: { id: 'greyjaw_fang', name: "Old Greyjaw's Fang", kind: 'quest', icon: '/woc/items/wolf_fang.webp', description: 'A fang from the old wolf no trap could hold.' },
  webwood_silk: { id: 'webwood_silk', name: 'Sableweb Silk Gland', kind: 'quest', icon: '/woc/items/boar_hide.webp', description: 'Still twitching. Apothecary Lin wants it.' },
  restless_skull: { id: 'restless_skull', name: 'Restless Skull', kind: 'quest', icon: '/woc/items/wolf_fang.webp', description: 'A skull from the chapel yard, denied its rest.' },
  supply_crate: { id: 'supply_crate', name: 'Stolen Supply Crate', kind: 'quest', icon: '/woc/items/copper_ore.webp', description: "Trader Wilkes' stolen goods, barely scratched." },
  gravecaller_sigil: { id: 'gravecaller_sigil', name: "Gravecaller's Sigil", kind: 'quest', icon: '/woc/items/ashen_focus_ring.webp', description: 'A sigil bearing the mark of the Gravecallers.' },
  weathered_ledger_page: { id: 'weathered_ledger_page', name: 'Weathered Ledger Page', kind: 'quest', icon: '/woc/items/baked_bread.webp', description: 'A page from the chapel burial ledger.' },
  blessed_wax: { id: 'blessed_wax', name: 'Blessed Tallow', kind: 'quest', icon: '/woc/items/spring_water.webp', description: 'Tallow blessed for the binding rite.' },
  ghostly_essence: { id: 'ghostly_essence', name: 'Ghostly Essence', kind: 'quest', icon: '/woc/items/lesser_mana_potion.webp', description: 'Cold essence drawn from the restless dead.' },
  morthen_grimoire: { id: 'morthen_grimoire', name: "Morthen's Grimoire", kind: 'quest', icon: '/woc/items/ashen_focus_ring.webp', description: 'The Gravecaller\'s rites and correspondence.' },

  greyjaw_pelt_cloak: GEAR('greyjaw_pelt_cloak', 'Greyjaw Pelt Cloak', 'armor', 3, { armor: 6, hp: 12 }, '/woc/items/wolfhide_satchel.webp', 'The old wolf\'s pelt, worn as a warning. +6 armor, +12 health.'),
  lychgate_buckler: GEAR('lychgate_buckler', 'Lychgate Buckler', 'trinket', 5, { armor: 10, hp: 8 }, '/woc/items/eastbrook_buckler.webp', 'A chapel gate reforged into a shield. +10 armor, +8 health.'),
  redbrook_blade: GEAR('redbrook_blade', 'Redbrook Blade', 'weapon', 4, { attack: 8, crit: 2 }, '/woc/items/anvilguard_blade.webp', 'The marshal\'s spare blade. +8 attack, +2% crit.'),
  apprentice_staff: GEAR('apprentice_staff', 'Apprentice Staff', 'weapon', 4, { spell: 8 }, '/woc/items/briarroot_staff.webp', 'A staff scribed by the marshal\'s mage. +8 spell.'),
  keen_dirk: GEAR('keen_dirk', 'Keen Dirk', 'weapon', 4, { attack: 7, crit: 3 }, '/woc/items/anvilguard_blade.webp', 'A quiet blade for quiet work. +7 attack, +3% crit.'),
  militia_vest: GEAR('militia_vest', 'Militia Vest', 'armor', 5, { armor: 9, hp: 14 }, '/woc/items/recruit_tunic.webp', 'Eastbrook militia issue. +9 armor, +14 health.'),
  woven_robe: GEAR('woven_robe', 'Woven Robe', 'armor', 5, { spell: 4, hp: 18 }, '/woc/items/apprentice_robe.webp', 'Warded cloth from the vale loom. +4 spell, +18 health.'),
  shadow_jerkin: GEAR('shadow_jerkin', 'Shadow Jerkin', 'armor', 5, { armor: 6, crit: 3 }, '/woc/items/recruit_tunic.webp', 'Dyed for the dark. +6 armor, +3% crit.'),
  gravecaller_blade: GEAR('gravecaller_blade', 'Gravecaller Blade', 'weapon', 7, { attack: 12, crit: 3 }, '/woc/items/anvilguard_blade.webp', 'Taken from the Hollow Crypt. +12 attack, +3% crit.'),
  widowfang_dirk: GEAR('widowfang_dirk', 'Widowfang Dirk', 'weapon', 7, { attack: 10, crit: 5 }, '/woc/items/anvilguard_blade.webp', 'A dirk that remembers the dark. +10 attack, +5% crit.'),
  gravecaller_staff: GEAR('gravecaller_staff', 'Gravecaller Staff', 'weapon', 7, { spell: 12, crit: 2 }, '/woc/items/briarroot_staff.webp', 'The Gravecaller\'s own staff. +12 spell, +2% crit.'),
  marrowtread_boots: GEAR('marrowtread_boots', 'Marrowtread Boots', 'armor', 7, { armor: 7, hp: 12 }, '/woc/items/milepost_boots.webp', 'Boots for walking where the dead walk. +7 armor, +12 health.'),
  sextons_slippers: GEAR('sextons_slippers', 'Sexton\'s Slippers', 'armor', 7, { spell: 4, hp: 14 }, '/woc/items/milepost_boots.webp', 'The old sexton\'s quiet shoes. +4 spell, +14 health.'),
  gravewalker_softboots: GEAR('gravewalker_softboots', 'Gravewalker Softboots', 'armor', 7, { armor: 5, crit: 3 }, '/woc/items/milepost_boots.webp', 'Soft enough to slip past the dead. +5 armor, +3% crit.'),
  bristleback_maul: GEAR('bristleback_maul', 'Bristleback Maul', 'weapon', 7, { attack: 13 }, '/woc/items/anvilguard_blade.webp', 'Heavy enough to stop a mogger. +13 attack.'),
  sableweb_slippers: GEAR('sableweb_slippers', 'Sableweb Slippers', 'armor', 7, { spell: 5, crit: 2 }, '/woc/items/milepost_boots.webp', 'Woven from the deepest web. +5 spell, +2% crit.'),
  moggers_stomper_boots: GEAR('moggers_stomper_boots', 'Mogger\'s Stomper Boots', 'armor', 7, { armor: 8, hp: 16 }, '/woc/items/milepost_boots.webp', 'Too big, too heavy, and perfect. +8 armor, +16 health.'),

  worn_sword: GEAR('worn_sword', 'Worn Sword', 'weapon', 1, { attack: 4 }, '/woc/items/worn_sword.webp', 'A dependable starter blade. +4 attack.'),
  gnarled_staff: GEAR('gnarled_staff', 'Gnarled Staff', 'weapon', 1, { spell: 4 }, '/woc/items/gnarled_staff.webp', 'A staff humming with old magic. +4 spell.'),
  recruit_tunic: GEAR('recruit_tunic', 'Recruit Tunic', 'armor', 1, { armor: 6, hp: 10 }, '/woc/items/recruit_tunic.webp', 'Padded road leathers. +6 armor, +10 health.'),
  apprentice_robe: GEAR('apprentice_robe', 'Apprentice Robe', 'armor', 1, { spell: 3, hp: 12 }, '/woc/items/apprentice_robe.webp', 'Woven with a beginner\'s runes. +3 spell, +12 health.'),
  eastbrook_buckler: GEAR('eastbrook_buckler', 'Eastbrook Buckler', 'trinket', 1, { armor: 8 }, '/woc/items/eastbrook_buckler.webp', 'A town guard\'s spare shield. +8 armor.'),
  milepost_boots: GEAR('milepost_boots', 'Milepost Boots', 'armor', 2, { armor: 4, hp: 6 }, '/woc/items/milepost_boots.webp', 'Sturdy boots for long roads. +4 armor, +6 health.'),
  wolfhide_satchel: GEAR('wolfhide_satchel', 'Wolfhide Satchel', 'trinket', 3, { hp: 12, crit: 2 }, '/woc/items/wolfhide_satchel.webp', 'A rare prize from Old Greyjaw. +12 health, +2% crit.'),
  brookwatch_helm: GEAR('brookwatch_helm', 'Brookwatch Helm', 'armor', 3, { armor: 5, hp: 10 }, '/woc/items/brookwatch_helm.webp', 'A dented but honest helm. +5 armor, +10 health.'),
  anvilguard_blade: GEAR('anvilguard_blade', 'Anvilguard Blade', 'weapon', 4, { attack: 9, crit: 2 }, '/woc/items/anvilguard_blade.webp', 'Forged for the vale militia. +9 attack, +2% crit.'),
  bogiron_mace: GEAR('bogiron_mace', 'Bogiron Mace', 'weapon', 4, { attack: 7, crit: 3 }, '/woc/items/bogiron_mace.webp', 'Heavy iron pulled from the marsh. +7 attack, +3% crit.'),
  briarroot_staff: GEAR('briarroot_staff', 'Briarroot Staff', 'weapon', 5, { spell: 10 }, '/woc/items/briarroot_staff.webp', 'Grown, not carved. +10 spell.'),
  ashrunner_boots: GEAR('ashrunner_boots', 'Ashrunner Boots', 'armor', 6, { armor: 3, crit: 3 }, '/woc/items/ashrunner_boots.webp', 'Light enough to dance through ash. +3 armor, +3% crit.'),
  ashen_focus_ring: GEAR('ashen_focus_ring', 'Ashen Focus Ring', 'trinket', 6, { spell: 4, crit: 2 }, '/woc/items/ashen_focus_ring.webp', 'A ring of cooled ember. +4 spell, +2% crit.'),
  bastion_kite_shield: GEAR('bastion_kite_shield', 'Bastion Kite Shield', 'trinket', 7, { armor: 14, hp: 8 }, '/woc/items/bastion_kite_shield.webp', 'A wall you can carry. +14 armor, +8 health.'),
  beastpit_warbelt: GEAR('beastpit_warbelt', 'Beastpit Warbelt', 'armor', 7, { armor: 8, hp: 18 }, '/woc/items/beastpit_warbelt.webp', 'Won from something with too many teeth. +8 armor, +18 health.'),
  burnished_thorium_amulet: GEAR('burnished_thorium_amulet', 'Burnished Thorium Amulet', 'trinket', 8, { spell: 8, crit: 3 }, '/woc/items/burnished_thorium_amulet.webp', 'Thorium polished to a mirror. +8 spell, +3% crit.'),
  cragthorn_greatstaff: GEAR('cragthorn_greatstaff', 'Cragthorn Greatstaff', 'weapon', 9, { spell: 14, crit: 2 }, '/woc/items/cragthorn_greatstaff.webp', 'A peak-briar staff that hums in storms. +14 spell, +2% crit.'),
};

const ZONE = (id, name, minLevel, art, blurb, mobs, boss, quests, music) => ({
  id, name, minLevel, art, blurb, mobs, boss, quests, music,
});

export const ZONES = [
  ZONE('eastbrook-vale', 'Eastbrook Vale', 1, '/woc/zones/eastbrook_vale.png',
    'Green fields, wolf runs, and a town that never quite sleeps easy.', [
      { id: 'forest_wolf', name: 'Forest Wolf', level: 1, hp: 78, min: 7, max: 11, armor: 10, xp: 45, sumo: 6, art: '/woc/mobs/forest_wolf.webp', loot: [{ itemId: 'wolf_fang', chance: 0.55 }, { itemId: 'boar_hide', chance: 0.2 }] },
      { id: 'thicket_boar', name: 'Bristly Boar', level: 2, hp: 96, min: 8, max: 13, armor: 16, xp: 55, sumo: 7, art: '/woc/mobs/thicket_boar.webp', loot: [{ itemId: 'boar_hide', chance: 0.6 }] },
      { id: 'wild_boar', name: 'Wild Boar', level: 2, hp: 90, min: 8, max: 13, armor: 14, xp: 52, sumo: 7, art: '/woc/mobs/wild_boar.webp', loot: [{ itemId: 'boar_hide', chance: 0.6 }] },
      { id: 'webwood_spider', name: 'Sableweb Lurker', level: 2, hp: 84, min: 7, max: 12, armor: 12, xp: 50, sumo: 6, art: '/woc/mobs/webwood_spider.webp', loot: [{ itemId: 'lesser_healing_potion', chance: 0.25 }, { itemId: 'webwood_silk', chance: 0.8 }], special: { name: 'Venom Bite', min: 12, max: 16, chance: 0.25, dot: { total: 8, turns: 2 } } },
      { id: 'mudfin_murloc', name: 'Mudfin Skulker', level: 3, hp: 120, min: 9, max: 14, armor: 18, xp: 65, sumo: 8, art: '/woc/mobs/mudfin_murloc.webp', loot: [{ itemId: 'spring_water', chance: 0.35 }] },
      { id: 'vale_bandit', name: 'Vale Bandit', level: 3, hp: 112, min: 10, max: 15, armor: 22, xp: 70, sumo: 9, art: '/woc/mobs/vale_bandit.webp', loot: [{ itemId: 'healing_potion', chance: 0.3 }, { itemId: 'worn_sword', chance: 0.12 }, { itemId: 'supply_crate', chance: 0.55 }], special: { name: 'Cheap Shot', min: 14, max: 19, chance: 0.3 } },
      { id: 'downs_bandit', name: 'Downs Bandit', level: 3, hp: 118, min: 10, max: 15, armor: 20, xp: 72, sumo: 9, art: '/woc/mobs/downs_bandit.webp', loot: [{ itemId: 'lesser_healing_potion', chance: 0.3 }], special: { name: 'Rusty Jab', min: 15, max: 20, chance: 0.3 } },
      { id: 'tunnel_rat', name: 'Deeprock Digger', level: 4, hp: 130, min: 11, max: 16, armor: 20, xp: 78, sumo: 10, art: '/woc/mobs/tunnel_rat.webp', loot: [{ itemId: 'copper_ore', chance: 0.4 }, { itemId: 'blessed_wax', chance: 0.55 }] },
      { id: 'restless_bones', name: 'Restless Bones', level: 5, hp: 150, min: 12, max: 18, armor: 26, xp: 92, sumo: 12, art: '/woc/mobs/restless_bones.webp', loot: [{ itemId: 'restless_skull', chance: 0.75 }, { itemId: 'ghostly_essence', chance: 0.5 }, { itemId: 'weathered_ledger_page', chance: 0.45 }, { itemId: 'gravecaller_sigil', chance: 0.15 }], special: { name: 'Grave Grasp', min: 18, max: 24, chance: 0.25, weaken: { pct: 0.2, turns: 2 } } },
      { id: 'greyjaw', name: 'Old Greyjaw', level: 5, hp: 230, min: 14, max: 20, armor: 26, xp: 140, sumo: 20, art: '/woc/mobs/greyjaw.webp', loot: [{ itemId: 'greyjaw_fang', chance: 1 }], special: { name: 'Savage Maul', min: 20, max: 26, chance: 0.35 }, requiresQuest: 'q_wolves' },
      { id: 'gorrak', name: 'Gorrak the Ruthless', level: 6, hp: 300, min: 16, max: 24, armor: 32, xp: 190, sumo: 28, art: '/woc/mobs/gorrak.webp', loot: [{ itemId: 'supply_crate', chance: 0.6 }, { itemId: 'healing_potion', chance: 0.5 }], special: { name: 'Cutthroat', min: 24, max: 30, chance: 0.35 }, requiresQuest: 'q_bandits' },
      { id: 'mogger', name: 'Mogger', level: 7, hp: 380, min: 18, max: 26, armor: 36, xp: 230, sumo: 34, art: '/woc/mobs/mogger.webp', loot: [{ itemId: 'boar_hide', chance: 1 }], special: { name: 'Trample', min: 28, max: 34, chance: 0.35, stun: 1 }, requiresQuest: 'q_gravecallers_trail' },
      { id: 'sexton_marrow', name: 'Sexton Marrow', level: 8, hp: 460, min: 20, max: 28, armor: 40, xp: 280, sumo: 40, art: '/woc/mobs/sexton_marrow.webp', loot: [{ itemId: 'ghostly_essence', chance: 1 }], special: { name: 'Grave Toll', min: 26, max: 34, chance: 0.35, stun: 1 }, requiresQuest: 'q_rite' },
    ],
    { id: 'morthen', name: 'Morthen the Gravecaller', level: 8, hp: 620, min: 22, max: 30, armor: 44, xp: 520, sumo: 90, art: '/woc/bosses/morthen.webp', loot: [{ itemId: 'morthen_grimoire', chance: 1 }, { itemId: 'healing_potion', chance: 1 }, { itemId: 'lychgate_buckler', chance: 0.4 }], special: { name: 'Grave Chill', min: 26, max: 34, chance: 0.35, weaken: { pct: 0.2, turns: 2 } }, requiresQuest: 'q_rite' },
    [
      { id: 'q_wolves', name: 'Wolves at the Door', npc: 'Marshal Redbrook',
        text: 'The forest wolves grow bold, snapping at travelers on the north road. Thin their numbers. Slay 8 Forest Wolves and Eastbrook will breathe easier.',
        completionText: 'Fine work. The road feels safer already.',
        objectives: [{ type: 'kill', mobId: 'forest_wolf', count: 8, label: 'Forest Wolf slain' }],
        rewards: { xp: 250, sumo: 75, items: {} } },
      { id: 'q_greyjaw', name: 'The Old Wolf', npc: 'Marshal Redbrook',
        text: "There is one wolf no trap has held: Old Greyjaw. He has taken three hounds and a stable boy's arm. He prowls the deep woods north of the wolf runs. Bring me his fang.",
        completionText: 'So the old devil is dead at last. The stable boy will sleep easier, and so will I.',
        objectives: [{ type: 'collect', itemId: 'greyjaw_fang', count: 1, label: "Old Greyjaw's Fang" }],
        requiresQuest: 'q_wolves',
        rewards: { xp: 450, sumo: 150, items: {}, classItems: { warrior: 'greyjaw_pelt_cloak', mage: 'greyjaw_pelt_cloak', rogue: 'greyjaw_pelt_cloak' } } },
      { id: 'q_boars', name: 'Bristly Boar Hides', npc: 'Trader Wilkes',
        text: 'Boar hide makes the finest travel packs, and the meadows northwest of town are crawling with the beasts. Bring me 5 Bristly Boar Hides and I will make it worth your time.',
        completionText: 'Ah, fine bristly hides! These will fetch a good price.',
        objectives: [{ type: 'collect', itemId: 'boar_hide', count: 5, label: 'Bristly Boar Hide' }],
        rewards: { xp: 350, sumo: 120, items: {} } },
      { id: 'q_spiders', name: 'Sableweb Menace', npc: 'Apothecary Lin',
        text: 'The lurkers in the northeastern woods spin a silk I need for my poultices, and they have grown far too numerous besides. Cull 6 Sableweb Lurkers and cut 4 silk glands from their bellies.',
        completionText: "Ugh, still twitching. Perfect. Here, you've earned this.",
        objectives: [
          { type: 'kill', mobId: 'webwood_spider', count: 6, label: 'Sableweb Lurker slain' },
          { type: 'collect', itemId: 'webwood_silk', count: 4, label: 'Sableweb Silk Gland' },
        ],
        minLevel: 2,
        rewards: { xp: 420, sumo: 140, items: {} } },
      { id: 'q_murlocs', name: 'Trouble at the Lake', npc: 'Fisherman Brandt',
        text: 'Twenty years I have fished Mirror Lake, and never lost a net until those gurgling fish-men crawled out of the shallows. Drive the Mudfin back: slay 8 of them. And watch yourself: where there is one mudfin, there are five.',
        completionText: 'Hah! That will teach them to mind their own mudholes.',
        objectives: [{ type: 'kill', mobId: 'mudfin_murloc', count: 8, label: 'Mudfin Skulker slain' }],
        minLevel: 3,
        rewards: { xp: 520, sumo: 180, items: {} } },
      { id: 'q_supplies', name: 'Stolen Supplies', npc: 'Trader Wilkes',
        text: 'Those bandits hit my last wagon and made off with four crates of goods: tools, salt, good Eastbrook linen. The crates are stacked around their camp in the northwest hills. Steal them back for me, would you?',
        completionText: 'My crates! Barely a scratch on them. You are a wonder.',
        objectives: [{ type: 'collect', itemId: 'supply_crate', count: 4, label: 'Stolen Supply Crate' }],
        minLevel: 3,
        rewards: { xp: 550, sumo: 250, items: {} } },
      { id: 'q_mine', name: 'Rats in the Mine', npc: 'Foreman Odell',
        text: 'We struck a fine copper vein and then those burrowing vermin came boiling out of the hillside. My crew will not set foot in the dig until it is cleared. Put down 10 Deeprock Diggers.',
        completionText: 'Ha! Back to work, lads! You have my thanks, and my coin.',
        objectives: [{ type: 'kill', mobId: 'tunnel_rat', count: 10, label: 'Deeprock Digger slain' }],
        minLevel: 4,
        rewards: { xp: 620, sumo: 220, items: {} } },
      { id: 'q_bones', name: 'The Restless Dead', npc: 'Brother Aldric',
        text: 'The old ruin on the northwest hill was a chapel once, and its yard a resting place. Something has stirred the dead from their sleep. Put them down and bring me a skull from each you lay to rest, eight in all, so I may speak the rites over them and grant the peace they were denied.',
        completionText: 'May they rest now, and may the Light forgive whatever woke them.',
        objectives: [{ type: 'collect', itemId: 'restless_skull', count: 8, label: 'Restless Skulls recovered' }],
        minLevel: 5,
        rewards: { xp: 700, sumo: 260, items: {}, classItems: { warrior: 'lychgate_buckler' } } },
      { id: 'q_bandits', name: 'Bandits of the Vale', npc: 'Marshal Redbrook',
        text: 'A pack of cutthroats has made camp in the northwest hills. They have robbed three wagons this week. Drive them out: slay 10 Vale Bandits.',
        completionText: 'Ten fewer knives in the dark. Take this: you have earned it.',
        objectives: [{ type: 'kill', mobId: 'vale_bandit', count: 10, label: 'Vale Bandit slain' }],
        requiresQuest: 'q_wolves',
        rewards: { xp: 550, sumo: 200, items: {}, classItems: { warrior: 'redbrook_blade', mage: 'apprentice_staff', rogue: 'keen_dirk' } } },
      { id: 'q_ringleader', name: 'The Ringleader', npc: 'Marshal Redbrook',
        text: 'The bandits answer to one man: Gorrak the Ruthless. Cut off the head and the body will scatter. He skulks at the heart of their camp. End him.',
        completionText: 'Gorrak is dead? Then the Vale is free of his shadow. You have done Eastbrook a great service.',
        objectives: [{ type: 'elite', mobId: 'gorrak', count: 1, label: 'Gorrak the Ruthless slain' }],
        requiresQuest: 'q_bandits',
        rewards: { xp: 800, sumo: 500, items: {}, classItems: { warrior: 'militia_vest', mage: 'woven_robe', rogue: 'shadow_jerkin' } } },
      { id: 'q_whispers', name: 'Whispers Below', npc: 'Brother Aldric',
        text: 'You have laid the dead to rest, but they will not stay resting: something calls them back. Search the chapel ruin for any trace of the one doing the calling. If you find a sigil or seal, bring it to me untouched.',
        completionText: 'This sigil... it bears the mark of the Gravecallers, a sect I had prayed was extinct. This is worse than I feared.',
        objectives: [{ type: 'collect', itemId: 'gravecaller_sigil', count: 1, label: "Gravecaller's Sigil" }],
        requiresQuest: 'q_bones',
        rewards: { xp: 400, sumo: 150, items: {} } },
      { id: 'q_names_of_the_dead', name: 'The Names of the Dead', npc: 'Brother Aldric',
        text: 'If the Gravecallers raised our dead, I must know whose graves they robbed. The chapel sexton kept a burial ledger, and the wind has scattered its pages across the chapel yard. Gather 3 of them for me. The dead deserve to be called by their names.',
        completionText: "These poor souls... and look here. Sexton Marrow, the chapel's own living caretaker, his grave the first disturbed. Morthen began with the very man who buried Eastbrook's dead.",
        objectives: [{ type: 'collect', itemId: 'weathered_ledger_page', count: 3, label: 'Weathered Ledger Page' }],
        requiresQuest: 'q_whispers',
        rewards: { xp: 600, sumo: 250, items: {} } },
      { id: 'q_silence_the_call', name: 'Silence the Call', npc: 'Brother Aldric',
        text: "Every name in that ledger is a soul Morthen means to drag from the earth, and the chapel yard already crawls with those he has called. Return 12 Restless Bones to their graves before the Gravecaller's whisper swells into a chorus.",
        completionText: 'The yard grows quieter, but the calling has not stopped. It rises from below now. From the crypt itself.',
        objectives: [{ type: 'kill', mobId: 'restless_bones', count: 12, label: 'Restless Bones silenced' }],
        requiresQuest: 'q_names_of_the_dead',
        rewards: { xp: 750, sumo: 300, items: {} } },
      { id: 'q_rite', name: 'The Binding Rite', npc: 'Brother Aldric',
        text: "The crypt beneath the chapel must be unsealed if we are to stop the Gravecaller, but only a binding rite will let the living pass. I need 4 lumps of Blessed Tallow (the mine's burrowers hoard tallow by the crate) and 6 Ghostly Essences from the restless dead.",
        completionText: 'It is done. The way below stands open... and may the Light forgive me for opening it. Gather your strongest companions before you descend. No one should face the Hollow alone.',
        objectives: [
          { type: 'collect', itemId: 'blessed_wax', count: 4, label: 'Blessed Tallow' },
          { type: 'collect', itemId: 'ghostly_essence', count: 6, label: 'Ghostly Essence' },
        ],
        requiresQuest: 'q_whispers',
        rewards: { xp: 700, sumo: 500, items: {} } },
      { id: 'q_hollow', name: 'Into the Hollow', npc: 'Brother Aldric',
        text: "Morthen the Gravecaller waits at the bottom of the Hollow Crypt, ringed by the elite dead he has raised. He is far beyond any one hero: take four companions, no fewer. End him, and the Vale's dead will finally sleep.",
        completionText: 'The whispering has stopped. You have done what the whole Vale could not. The dead sleep, and Eastbrook owes you everything it has.',
        objectives: [{ type: 'boss', mobId: 'morthen', count: 1, label: 'Morthen the Gravecaller slain' }],
        requiresQuest: 'q_rite',
        rewards: { xp: 1500, sumo: 10000, items: {}, classItems: { warrior: 'gravecaller_blade', rogue: 'widowfang_dirk', mage: 'gravecaller_staff' } } },
      { id: 'q_sexton', name: "The Sexton's Bell", npc: 'Brother Aldric',
        text: "The ledger named him and the crypt holds him: Sexton Marrow, the chapel's caretaker, the first man Morthen raised, guarding his master's door in death as faithfully as he kept the chapel in life. Take four companions into the Hollow Crypt and grant the old sexton the rest he was robbed of.",
        completionText: 'So Marrow is free at last. Ring no bell for him: he heard enough of them in life.',
        objectives: [{ type: 'elite', mobId: 'sexton_marrow', count: 1, label: 'Sexton Marrow laid to rest' }],
        requiresQuest: 'q_rite',
        rewards: { xp: 1000, sumo: 600, items: {}, classItems: { warrior: 'marrowtread_boots', mage: 'sextons_slippers', rogue: 'gravewalker_softboots' } } },
      { id: 'q_gravecallers_trail', name: "The Gravecaller's Trail", npc: 'Brother Aldric',
        text: "Morthen is dead, yet a question gnaws at me: a sect that hid for a century does not spend itself on one village chapel. He kept a grimoire: his rites, his correspondence. If anything of it survives, it lies in the vestry of the ruined chapel above the crypt. Search the ruin and bring me whatever remains of his writings.",
        completionText: "Morthen wrote to a 'Fogbinder' in the northern fen. The sect is not dead. It has merely been patient.",
        objectives: [{ type: 'collect', itemId: 'morthen_grimoire', count: 1, label: "Morthen's Grimoire" }],
        requiresQuest: 'q_hollow',
        rewards: { xp: 900, sumo: 400, items: {} } },
      { id: 'q_divine_tome', name: 'The Dawnbound Tome', npc: 'Brother Aldric',
        text: 'The Light does not rest in you quietly. I have watched you lay the dead to peace, and I believe you are ready for what few paladins are ever taught: the Rite of Recall, by which a fallen soul is called back to the living. Its words are kept in the Dawnbound Tome, here in my keeping, but a book is no blessing while the restless dead still walk this ground. Return 6 more Restless Bones to the earth, and I will begin to teach you.',
        completionText: 'The chapel yard grows quiet. You are ready for the words, but the Rite of Recall cannot be spoken in a warm chapel. It must be sung where the veil between life and death wears thin. I mean to carry the Tome north into the Mirefen Marsh. Follow me there, and we will finish this.',
        objectives: [{ type: 'kill', mobId: 'restless_bones', count: 6, label: 'Restless Bones laid to rest' }],
        requiresQuest: 'q_bones',
        requiredClass: ['paladin'],
        minLevel: 6,
        rewards: { xp: 650, sumo: 200, items: {} } },
      { id: 'q_mogger', name: 'Mogger Must Fall', npc: 'Marshal Redbrook',
        text: 'Mogger has split carts, flattened fences, and killed enough livestock to empty half the Vale. Do not face him alone. Take two strong companions into the western meadow and put the brute down for good.',
        completionText: "Mogger dead at last. Eastbrook's fields are safer, and you leave the Vale with one more tale worth retelling.",
        objectives: [{ type: 'elite', mobId: 'mogger', count: 1, label: 'Mogger slain' }],
        requiresQuest: 'q_gravecallers_trail',
        minLevel: 6,
        rewards: { xp: 1200, sumo: 900, items: {}, classItems: { warrior: 'bristleback_maul', mage: 'sableweb_slippers', rogue: 'moggers_stomper_boots' } } },
    ], 'vale'),

  ZONE('mirefen-marsh', 'Mirefen Marsh', 4, '/woc/zones/mirefen_marsh.png',
    'Fog, reeds, and things that watch from the water.', [
      { id: 'mudfin_murloc', name: 'Mudfin Murloc', level: 4, hp: 138, min: 11, max: 16, armor: 18, xp: 85, sumo: 11, art: '/woc/mobs/mudfin_murloc.webp', loot: [{ itemId: 'spring_water', chance: 0.4 }] },
      { id: 'deepfen_murloc', name: 'Deepfen Skulker', level: 5, hp: 156, min: 13, max: 18, armor: 22, xp: 100, sumo: 13, art: '/woc/mobs/deepfen_murloc.webp', loot: [{ itemId: 'mana_potion', chance: 0.3 }], special: { name: 'Frenzied Bite', min: 18, max: 24, chance: 0.3 } },
      { id: 'fen_troll', name: 'Fen Troll', level: 6, hp: 210, min: 15, max: 22, armor: 30, xp: 130, sumo: 16, art: '/woc/mobs/fen_troll.webp', loot: [{ itemId: 'iron_ore', chance: 0.3 }] },
      { id: 'mirefen_raptor', name: 'Mirefen Raptor', level: 4, hp: 132, min: 11, max: 16, armor: 20, xp: 88, sumo: 11, art: '/woc/mobs/basin_raptor.webp', loot: [{ itemId: 'lesser_mana_potion', chance: 0.25 }], special: { name: 'Ripping Talons', min: 17, max: 22, chance: 0.25 } },
      { id: 'bog_wraith', name: 'Bog Wraith', level: 6, hp: 188, min: 15, max: 21, armor: 24, xp: 125, sumo: 15, art: '/woc/mobs/wood_wraith.webp', loot: [{ itemId: 'lesser_healing_potion', chance: 0.3 }], special: { name: 'Wailing Chill', min: 20, max: 26, chance: 0.3, weaken: { pct: 0.2, turns: 2 } } },
    ],
    { id: 'mere_hydra', name: 'The Mere Hydra', level: 7, hp: 380, min: 17, max: 25, armor: 38, xp: 380, sumo: 65, art: '/woc/bosses/mere_hydra_head_center.webp', loot: [{ itemId: 'healing_potion', chance: 1 }, { itemId: 'mana_potion', chance: 1 }, { itemId: 'bogiron_mace', chance: 0.5 }, { itemId: 'briarroot_staff', chance: 0.35 }], special: { name: 'Venom Spray', min: 22, max: 30, chance: 0.35, dot: { total: 15, turns: 2 } } },
    [
      { id: 'q_marsh_murlocs', name: 'Reeds and Teeth', npc: 'Warden Sable', text: 'The murlocs are dragging nets through the spawning shallows. Break them up.', objectives: [{ type: 'kill', mobId: 'mudfin_murloc', count: 4, label: 'Mudfin Murlocs defeated' }], rewards: { xp: 220, sumo: 28, items: { mana_potion: 2 } } },
      { id: 'q_marsh_ore', name: 'Bog Iron', npc: 'Smith Ordell', text: 'The fen hides good iron under all that muck. Bring me four samples.', objectives: [{ type: 'collect', itemId: 'iron_ore', count: 4, label: 'Iron Ore gathered' }], rewards: { xp: 260, sumo: 32, items: { healing_potion: 2 } } },
      { id: 'q_marsh_hydra', name: 'The Mere Hydra', npc: 'Warden Sable', text: 'Three heads, one temper. End it before the ferrymen are next.', objectives: [{ type: 'boss', zoneId: 'mirefen-marsh', label: 'The Mere Hydra defeated' }], rewards: { xp: 400, sumo: 70, items: { healing_potion: 3 } } },
    ], 'marsh'),

  ZONE('thornpeak-heights', 'Thornpeak Heights', 7, '/woc/zones/thornpeak_heights.png',
    'Cold stone, old oaths, and ogres who remember both.', [
      { id: 'snowdrift_wolf', name: 'Snowdrift Wolf', level: 7, hp: 210, min: 16, max: 22, armor: 26, xp: 140, sumo: 17, art: '/woc/mobs/snowdrift_wolf.webp', loot: [{ itemId: 'wolf_fang', chance: 0.5 }] },
      { id: 'ice_wraith', name: 'Ice Wraith', level: 8, hp: 196, min: 18, max: 25, armor: 24, xp: 155, sumo: 18, art: '/woc/mobs/ice_wraith.webp', loot: [{ itemId: 'mana_potion', chance: 0.35 }], special: { name: 'Frozen Grasp', min: 24, max: 31, chance: 0.35, stun: 1 } },
      { id: 'thornpeak_ogre', name: 'Thornpeak Ogre', level: 9, hp: 280, min: 20, max: 28, armor: 40, xp: 180, sumo: 21, art: '/woc/mobs/thornpeak_ogre.webp', loot: [{ itemId: 'thorium_ore', chance: 0.2 }] },
      { id: 'deeprock_kobold', name: 'Deeprock Kobold', level: 7, hp: 176, min: 15, max: 21, armor: 28, xp: 135, sumo: 16, art: '/woc/mobs/deeprock_kobold.webp', loot: [{ itemId: 'copper_ore', chance: 0.5 }] },
      { id: 'frostmane_yeti', name: 'Frostmane Yeti', level: 9, hp: 270, min: 20, max: 27, armor: 38, xp: 175, sumo: 20, art: '/woc/mobs/frostmane_yeti.webp', loot: [{ itemId: 'brookwatch_helm', chance: 0.25 }], special: { name: 'Frost Slam', min: 26, max: 34, chance: 0.3, stun: 1 } },
    ],
    { id: 'korgath', name: 'Korgath the Bound', level: 10, hp: 520, min: 22, max: 32, armor: 48, xp: 520, sumo: 90, art: '/woc/bosses/korgath_the_bound.webp', loot: [{ itemId: 'healing_potion', chance: 1 }, { itemId: 'mana_potion', chance: 1 }, { itemId: 'bastion_kite_shield', chance: 0.5 }, { itemId: 'cragthorn_greatstaff', chance: 0.25 }], special: { name: 'Ruinous Slam', min: 30, max: 40, chance: 0.4, stun: 1 } },
    [
      { id: 'q_peaks_wolves', name: 'Winter Cull', npc: 'Scout Elin', text: 'The snowdrift packs are starving and ranging too close to the pass.', objectives: [{ type: 'kill', mobId: 'snowdrift_wolf', count: 5, label: 'Snowdrift Wolves defeated' }], rewards: { xp: 340, sumo: 40, items: { healing_potion: 2 } } },
      { id: 'q_peaks_ore', name: 'Thorium for the Forge', npc: 'Smith Ordell', text: 'Three pieces of thorium, and I can finish the order.', objectives: [{ type: 'collect', itemId: 'thorium_ore', count: 3, label: 'Thorium Ore gathered' }], rewards: { xp: 380, sumo: 45, items: { mana_potion: 3 } } },
      { id: 'q_peaks_korgath', name: 'Break the Binding', npc: 'Scout Elin', text: 'Korgath was chained for a reason. The chains are failing.', objectives: [{ type: 'boss', zoneId: 'thornpeak-heights', label: 'Korgath the Bound defeated' }], rewards: { xp: 560, sumo: 95, items: { healing_potion: 4 } } },
    ], 'peaks'),

  ZONE('drakelands', 'Drakelands', 9, '/woc/zones/drakelands.png',
    'Ash on the wind, drakes overhead, and a gravewyrm beneath it all.', [
      { id: 'emberwing_drake', name: 'Emberwing Drake', level: 9, hp: 300, min: 21, max: 29, armor: 38, xp: 210, sumo: 24, art: '/woc/mobs/emberwing_drake.webp', loot: [{ itemId: 'thorium_ore', chance: 0.25 }], special: { name: 'Ember Breath', min: 28, max: 36, chance: 0.3, dot: { total: 12, turns: 2 } } },
      { id: 'rift_stone_ogre', name: 'Rift Stone Ogre', level: 10, hp: 360, min: 23, max: 32, armor: 48, xp: 235, sumo: 26, art: '/woc/mobs/rift_stone_ogre.webp', loot: [{ itemId: 'iron_ore', chance: 0.4 }] },
      { id: 'skeleton_warrior', name: 'Nythraxis Boneguard', level: 11, hp: 320, min: 24, max: 33, armor: 42, xp: 255, sumo: 28, art: '/woc/mobs/nythraxis_skeleton_warrior.webp', loot: [{ itemId: 'healing_potion', chance: 0.35 }] },
      { id: 'ogre_crusher', name: 'Ogre Crusher', level: 10, hp: 360, min: 23, max: 31, armor: 46, xp: 230, sumo: 26, art: '/woc/mobs/ogre_crusher.webp', loot: [{ itemId: 'iron_ore', chance: 0.45 }], special: { name: 'Crushing Blow', min: 32, max: 40, chance: 0.3 } },
      { id: 'reliquary_wraith', name: 'Reliquary Wraith', level: 11, hp: 300, min: 24, max: 32, armor: 40, xp: 250, sumo: 28, art: '/woc/mobs/reliquary_ledger_wraith.webp', loot: [{ itemId: 'ashen_focus_ring', chance: 0.2 }], special: { name: 'Ledger Curse', min: 26, max: 34, chance: 0.3, dot: { total: 14, turns: 2 } } },
    ],
    { id: 'korzul', name: 'Korzul the Gravewyrm', level: 12, hp: 720, min: 26, max: 38, armor: 56, xp: 800, sumo: 140, art: '/woc/bosses/korzul_the_gravewyrm.webp', loot: [{ itemId: 'healing_potion', chance: 1 }, { itemId: 'mana_potion', chance: 1 }, { itemId: 'thorium_ore', chance: 1 }, { itemId: 'burnished_thorium_amulet', chance: 1 }, { itemId: 'cragthorn_greatstaff', chance: 0.3 }], special: { name: 'Grave Breath', min: 34, max: 46, chance: 0.4, dot: { total: 18, turns: 2 } } },
    [
      { id: 'q_drake_cull', name: 'Ash and Wing', npc: 'Watcher Bran', text: 'The drakes are nesting too close to the road. Cull six of them.', objectives: [{ type: 'kill', mobId: 'emberwing_drake', count: 6, label: 'Emberwing Drakes defeated' }], rewards: { xp: 480, sumo: 60, items: { healing_potion: 3 } } },
      { id: 'q_drake_ore', name: 'The Last Ingot', npc: 'Smith Ordell', text: 'Five thorium, and I will forge something worth carrying into the ash.', objectives: [{ type: 'collect', itemId: 'thorium_ore', count: 5, label: 'Thorium Ore gathered' }], rewards: { xp: 520, sumo: 65, items: { mana_potion: 4 } } },
      { id: 'q_drake_wyrm', name: 'Korzul the Gravewyrm', npc: 'Watcher Bran', text: 'Every road ends at the gravewyrm. Make sure yours does not.', objectives: [{ type: 'boss', zoneId: 'drakelands', label: 'Korzul the Gravewyrm defeated' }], rewards: { xp: 900, sumo: 150, items: { healing_potion: 5 } } },
    ], 'ignivar_inner_crucible'),

  ZONE('willowfen', 'Willowfen', 11, '/woc/zones/willowfen.png',
    'Drowned willows, old pacts, and a guardian who never learned to sleep.', [
      { id: 'pact_imp', name: 'Pact Imp', level: 11, hp: 260, min: 22, max: 29, armor: 36, xp: 240, sumo: 27, art: '/woc/mobs/warlock_imp.webp', loot: [{ itemId: 'lesser_mana_potion', chance: 0.4 }], special: { name: 'Ember Pact', min: 28, max: 34, chance: 0.3, dot: { total: 10, turns: 2 } } },
      { id: 'willowfen_troll', name: 'Willowfen Troll', level: 11, hp: 380, min: 24, max: 32, armor: 48, xp: 260, sumo: 29, art: '/woc/mobs/dune_troll.webp', loot: [{ itemId: 'beastpit_warbelt', chance: 0.2 }] },
      { id: 'hoard_bat', name: 'Hoard Bat', level: 12, hp: 320, min: 26, max: 34, armor: 40, xp: 280, sumo: 30, art: '/woc/mobs/hoard_boss_bat.webp', loot: [{ itemId: 'lesser_healing_potion', chance: 0.35 }], special: { name: 'Screech', min: 30, max: 38, chance: 0.3, stun: 1 } },
    ],
    { id: 'ancient_guardian', name: 'The Ancient Guardian', level: 12, hp: 820, min: 30, max: 42, armor: 60, xp: 900, sumo: 160, art: '/woc/bosses/ancient_guardian.webp', loot: [{ itemId: 'burnished_thorium_amulet', chance: 1 }, { itemId: 'cragthorn_greatstaff', chance: 1 }, { itemId: 'healing_potion', chance: 1 }], special: { name: 'Rooted Judgment', min: 36, max: 48, chance: 0.4, stun: 1 } },
    [
      { id: 'q_fen_trolls', name: 'Root and Bone', npc: 'Keeper Willow', text: 'The trolls are tearing the old roots apart. Stop them before the fen drains.', objectives: [{ type: 'kill', mobId: 'willowfen_troll', count: 4, label: 'Willowfen Trolls defeated' }], rewards: { xp: 520, sumo: 65, items: { healing_potion: 3 } } },
      { id: 'q_fen_bats', name: 'Wings in the Willows', npc: 'Keeper Willow', text: 'The hoard bats carry something that is not theirs. Bring back the quiet.', objectives: [{ type: 'kill', mobId: 'hoard_bat', count: 5, label: 'Hoard Bats defeated' }], rewards: { xp: 560, sumo: 70, items: { mana_potion: 3 } } },
      { id: 'q_fen_guardian', name: 'The Ancient Guardian', npc: 'Keeper Willow', text: 'It guarded this fen before the town had a name. Wake it once more, and end it gently.', objectives: [{ type: 'boss', zoneId: 'willowfen', label: 'The Ancient Guardian defeated' }], rewards: { xp: 1000, sumo: 180, items: { healing_potion: 5 } } },
    ], 'garden'),
];

export const CROPS = {
  vale_wheat: { id: 'vale_wheat', name: 'Vale Wheat', icon: '/woc/items/baked_bread.webp', growMs: 3 * 60 * 1000, yield: { itemId: 'baked_bread', count: 2 } },
  sunroot: { id: 'sunroot', name: 'Sunroot', icon: '/woc/items/spring_water.webp', growMs: 5 * 60 * 1000, yield: { itemId: 'healing_potion', count: 1 } },
};

const classById = (id) => CLASSES.find((entry) => entry.id === id) ?? null;
const zoneById = (id) => ZONES.find((entry) => entry.id === id) ?? null;
const abilityById = (id) => ABILITIES[id] ?? null;

export function playerStats(entry) {
  const klass = classById(entry.className);
  const level = entry.level;
  const bonus = { attack: 0, spell: 0, armor: 0, hp: 0, crit: 0 };
  for (const itemId of Object.values(entry.equipment ?? {})) {
    const item = ITEMS[itemId];
    for (const [key, value] of Object.entries(item?.stats ?? {})) bonus[key] += value;
  }
  return {
    maxHp: Math.round(klass.baseHp + klass.hpPerLevel * (level - 1)) + bonus.hp,
    attack: klass.attack + klass.attackPerLevel * (level - 1) + bonus.attack,
    spell: klass.spell + klass.spellPerLevel * (level - 1) + bonus.spell,
    armor: klass.armor + klass.armorPerLevel * (level - 1) + bonus.armor,
    crit: 8 + bonus.crit,
    resourceMax: klass.resourceMax + Math.round(level * 1.5),
    resourceRegen: klass.resourceRegen,
  };
}

function freshPlayer(className) {
  const klass = classById(className);
  const stats = playerStats({ className, level: 1 });
  return {
    className,
    level: 1,
    xp: 0,
    hp: stats.maxHp,
    resource: Math.round(stats.resourceMax * 0.5),
    inventory: { baked_bread: 2, spring_water: 2 },
    equipment: {},
    quests: {},
    questProgress: {},
    kills: {},
    bosses: [],
    sumoEarned: 0,
    battle: null,
    lastResult: null,
    farm: { plots: [] },
    createdAt: Date.now(),
  };
}

function playerView(entry) {
  const klass = classById(entry.className);
  const stats = playerStats(entry);
  return {
    className: klass.id,
    name: klass.name,
    title: klass.title,
    portrait: klass.portrait,
    blurb: klass.blurb,
    resourceName: klass.resourceName,
    level: entry.level,
    xp: entry.xp,
    xpNext: xpForLevel(entry.level),
    hp: Math.max(0, Math.round(entry.hp)),
    maxHp: stats.maxHp,
    resource: Math.max(0, Math.round(entry.resource)),
    resourceMax: stats.resourceMax,
    attack: Math.round(stats.attack),
    spell: Math.round(stats.spell),
    armor: Math.round(stats.armor),
    crit: Math.round(stats.crit),
    sumoEarned: entry.sumoEarned,
    equipment: Object.fromEntries(
      ['weapon', 'armor', 'trinket'].map((slot) => [slot, ITEMS[entry.equipment?.[slot]] ?? null]),
    ),
    abilities: klass.abilities.map((id) => ABILITIES[id]),
  };
}

// Class reward groups from ClaudeCraft's per-class itemRewards maps.
const CLASS_REWARD_GROUP = {
  warrior: 'warrior', paladin: 'warrior', shaman: 'warrior',
  mage: 'mage', priest: 'mage', warlock: 'mage', druid: 'mage',
  rogue: 'rogue', hunter: 'rogue',
};

const QUEST_BY_ID = new Map();
for (const zone of ZONES) for (const quest of zone.quests) QUEST_BY_ID.set(quest.id, quest);

function objectiveCount(entry, quest, objective, index) {
  if (objective.type === 'collect') return entry.inventory[objective.itemId] ?? 0;
  if (objective.type === 'boss' && objective.zoneId) return entry.bosses.includes(objective.zoneId) ? 1 : 0;
  return entry.questProgress?.[quest.id]?.[index] ?? 0;
}

function questLockedReason(entry, quest) {
  if (quest.requiresQuest && entry.quests[quest.requiresQuest] !== 'done') {
    const prerequisite = QUEST_BY_ID.get(quest.requiresQuest);
    return `Requires ${prerequisite ? prerequisite.name : quest.requiresQuest}`;
  }
  if (quest.minLevel && entry.level < quest.minLevel) return `Requires level ${quest.minLevel}`;
  if (quest.requiredClass && !quest.requiredClass.includes(entry.className)) {
    return `Only ${quest.requiredClass.map((id) => id[0].toUpperCase() + id.slice(1)).join(', ')} may take this quest`;
  }
  return null;
}

function questState(entry, quest) {
  if (entry.quests[quest.id] === 'done') return 'done';
  if (questLockedReason(entry, quest)) return 'locked';
  if (entry.quests[quest.id] === 'active') {
    const complete = quest.objectives.every((objective, index) => {
      const required = objective.type === 'boss' || objective.type === 'elite' ? 1 : objective.count;
      return objectiveCount(entry, quest, objective, index) >= required;
    });
    return complete ? 'ready' : 'active';
  }
  return 'available';
}

function questView(entry, quest) {
  const state = questState(entry, quest);
  const lockedReason = state === 'locked' ? questLockedReason(entry, quest) : null;
  const objectives = quest.objectives.map((objective, index) => {
    const required = objective.type === 'boss' || objective.type === 'elite' ? 1 : objective.count;
    const current = Math.min(required, objectiveCount(entry, quest, objective, index));
    return { label: objective.label, current, required, done: current >= required };
  });
  const current = objectives.reduce((sum, objective) => sum + objective.current, 0);
  const required = objectives.reduce((sum, objective) => sum + objective.required, 0);
  return {
    id: quest.id,
    name: quest.name,
    npc: quest.npc,
    text: quest.text,
    completionText: quest.completionText ?? '',
    label: objectives.map((objective) => objective.label).join(' · '),
    objectives,
    current,
    required,
    state,
    lockedReason,
    canTurnIn: state === 'ready',
    rewards: { ...quest.rewards, classItem: resolveClassReward(entry, quest) },
  };
}

function resolveClassReward(entry, quest) {
  const map = quest.rewards.classItems;
  if (!map) return null;
  return map[CLASS_REWARD_GROUP[entry.className] ?? 'warrior'] ?? null;
}

// ClaudeCraft combat math (combat/effect_dispatch.ts, mob_combat.ts).
const ABOVE_LEVEL_MISS_PCT = [0, 2.5, 8, 14];

function aboveLevelMissPct(diff) {
  return ABOVE_LEVEL_MISS_PCT[Math.min(ABOVE_LEVEL_MISS_PCT.length - 1, Math.max(0, diff))];
}

function meleeMissChance(attackerLevel, targetLevel) {
  const diff = targetLevel - attackerLevel;
  const miss = diff > 0 ? 5 + aboveLevelMissPct(diff) : 5 + diff * 0.2;
  return Math.min(0.95, Math.max(0.005, miss / 100));
}

function spellHitChance(attackerLevel, targetLevel) {
  const diff = targetLevel - attackerLevel;
  const hit = diff <= 0 ? 96 - diff : 96 - aboveLevelMissPct(diff);
  return Math.min(0.99, Math.max(0.05, hit / 100));
}

function armorReduction(armor, attackerLevel) {
  const value = Math.max(0, armor);
  return Math.min(0.75, value / (value + 85 * Math.max(1, attackerLevel) + 400));
}

function mobArmorReduction(armor, mobLevel, playerLevel) {
  const dr = armorReduction(armor, mobLevel);
  return mobLevel < playerLevel ? Math.min(dr, 0.2) : dr;
}

function swingMissChance(attackerLevel, targetLevel, attackerIsMob) {
  const miss = meleeMissChance(attackerLevel, targetLevel);
  return attackerIsMob ? Math.min(0.2, miss) : miss;
}

function rollDamage(base, critChance, critMultiplier, reduction) {
  const crit = Math.random() < critChance;
  const raw = crit ? base * critMultiplier : base;
  return { dealt: Math.max(1, Math.round(raw * (1 - reduction))), crit };
}

function zoneView(entry, zone) {
  return {
    id: zone.id,
    name: zone.name,
    minLevel: zone.minLevel,
    art: zone.art,
    blur: zone.blurb,
    music: zone.music ?? null,
    unlocked: entry.level >= zone.minLevel,
    cleared: entry.bosses.includes(zone.id),
    mobs: zone.mobs.map((mob) => ({
      id: mob.id,
      name: mob.name,
      level: mob.level,
      hp: mob.hp,
      art: mob.art,
      xp: mob.xp,
      sumo: mob.sumo,
      requiresQuest: mob.requiresQuest ?? null,
      locked: Boolean(mob.requiresQuest && entry.quests[mob.requiresQuest] !== 'done'),
    })),
    boss: {
      id: zone.boss.id,
      name: zone.boss.name,
      level: zone.boss.level,
      hp: zone.boss.hp,
      art: zone.boss.art,
      xp: zone.boss.xp,
      sumo: zone.boss.sumo,
      title: ANTAGONIST_LORE[zone.id]?.title ?? null,
      taunt: ANTAGONIST_LORE[zone.id]?.taunt ?? null,
      requiresQuest: zone.boss.requiresQuest ?? null,
      locked: Boolean(zone.boss.requiresQuest && entry.quests[zone.boss.requiresQuest] !== 'done'),
      defeated: entry.bosses.includes(zone.id),
    },
    quests: zone.quests.map((quest) => questView(entry, quest)),
  };
}

function farmView(entry) {
  const now = Date.now();
  return {
    crops: Object.values(CROPS).map((crop) => ({
      id: crop.id, name: crop.name, icon: crop.icon, growMs: crop.growMs, yield: crop.yield,
    })),
    plots: [0, 1, 2].map((index) => {
      const plot = (entry.farm?.plots ?? []).find((item) => item.index === index) ?? null;
      if (!plot) return { index, crop: null, ready: false };
      const crop = CROPS[plot.cropId];
      return {
        index,
        crop: crop ? { id: crop.id, name: crop.name, icon: crop.icon } : null,
        ready: now >= plot.readyAt,
        remainingMs: Math.max(0, plot.readyAt - now),
      };
    }),
  };
}

export function createAdventure({ store }) {
  function requirePlayer(address) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
      throw new GameError('A valid wallet address is required.');
    }
    const entry = store.getAdventure(address);
    if (!entry) throw new GameError('Choose a class to begin your adventure.', 409);
    return entry;
  }

  function save(address, entry) {
    store.saveAdventure(address, entry);
    return entry;
  }

  function overview(address) {
    const entry = store.getAdventure(address);
    const zones = ZONES.map((zone) => {
      const klass = entry ? playerView(entry) : null;
      return {
        ...zoneView(entry ?? { level: 0, kills: {}, inventory: {}, quests: {}, bosses: [] }, zone),
        level: klass?.level ?? 0,
      };
    });
    return {
      player: entry ? playerView(entry) : null,
      localBalance: entry ? store.progress(address).localBalance : 0,
      classes: entry ? [] : CLASSES.map((klass) => ({
        id: klass.id, name: klass.name, title: klass.title, resourceName: klass.resourceName,
        portrait: klass.portrait, blurb: klass.blurb,
      })),
      zones,
      battle: entry?.battle ?? null,
      lastResult: entry?.lastResult ?? null,
      inventory: entry ? inventoryView(entry) : [],
      farm: entry ? farmView(entry) : null,
      items: Object.fromEntries(
        Object.values(ITEMS).map((item) => [item.id, { name: item.name, icon: item.icon }]),
      ),
    };
  }

  function inventoryView(entry) {
    return Object.entries(entry.inventory)
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const item = ITEMS[id] ?? { id, name: id, icon: '/woc/items/baked_bread.webp', description: 'Adventure item.' };
        return { ...item, count };
      });
  }

  function chooseClass(address, className) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) {
      throw new GameError('A valid wallet address is required.');
    }
    if (!classById(className)) throw new GameError('Unknown class.', 404);
    if (store.getAdventure(address)) throw new GameError('A class was already chosen for this wallet.', 409);
    save(address, freshPlayer(className));
    return overview(address);
  }

  function findQuest(questId) {
    for (const zone of ZONES) {
      const quest = zone.quests.find((entry) => entry.id === questId);
      if (quest) return { zone, quest };
    }
    return null;
  }

  function acceptQuest(address, questId) {
    const entry = requirePlayer(address);
    const found = findQuest(questId);
    if (!found) throw new GameError('Unknown quest.', 404);
    if (entry.level < found.zone.minLevel) throw new GameError('This zone is not open to you yet.', 409);
    const state = questState(entry, found.quest);
    if (state === 'done') return overview(address);
    if (state === 'locked') throw new GameError(questLockedReason(entry, found.quest) ?? 'This quest is locked.', 409);
    if (state !== 'available') throw new GameError('You have already accepted this quest.', 409);
    entry.quests[questId] = 'active';
    save(address, entry);
    return overview(address);
  }

  function turnInQuest(address, questId) {
    const entry = requirePlayer(address);
    const found = findQuest(questId);
    if (!found) throw new GameError('Unknown quest.', 404);
    const view = questView(entry, found.quest);
    if (view.state === 'done') throw new GameError('You have already completed this quest.', 409);
    if (view.state !== 'ready') throw new GameError('The objectives are not complete yet.', 409);
    for (const objective of found.quest.objectives) {
      if (objective.type !== 'collect') continue;
      const remaining = (entry.inventory[objective.itemId] ?? 0) - objective.count;
      if (remaining > 0) entry.inventory[objective.itemId] = remaining;
      else delete entry.inventory[objective.itemId];
    }
    const items = { ...found.quest.rewards.items };
    const classItem = resolveClassReward(entry, found.quest);
    if (classItem) items[classItem] = (items[classItem] ?? 0) + 1;
    entry.quests[questId] = 'done';
    const granted = grant(entry, { ...found.quest.rewards, items });
    entry.lastResult = {
      kind: 'quest',
      title: found.quest.name,
      message: found.quest.completionText || `${found.quest.npc} accepts your work.`,
      ...granted,
    };
    save(address, entry);
    return overview(address);
  }

  function creditQuestObjectives(entry, mobId) {
    if (!entry.questProgress) entry.questProgress = {};
    for (const zone of ZONES) {
      for (const quest of zone.quests) {
        if (entry.quests[quest.id] !== 'active') continue;
        quest.objectives.forEach((objective, index) => {
          if (objective.type === 'collect' || objective.mobId !== mobId) return;
          const progress = entry.questProgress[quest.id] ?? {};
          progress[index] = (progress[index] ?? 0) + 1;
          entry.questProgress[quest.id] = progress;
        });
      }
    }
  }

  function grant(entry, rewards) {
    entry.xp += rewards.xp ?? 0;
    const sumo = rewards.sumo ?? 0;
    entry.sumoEarned += sumo;
    for (const [itemId, count] of Object.entries(rewards.items ?? {})) {
      entry.inventory[itemId] = (entry.inventory[itemId] ?? 0) + count;
    }
    const levels = levelUps(entry);
    return { xp: rewards.xp ?? 0, sumo, items: rewards.items ?? {}, levels };
  }

  function levelUps(entry) {
    let gained = 0;
    while (entry.level < MAX_LEVEL && entry.xp >= xpForLevel(entry.level)) {
      entry.xp -= xpForLevel(entry.level);
      entry.level += 1;
      gained += 1;
    }
    if (gained > 0) {
      const stats = playerStats(entry);
      entry.hp = stats.maxHp;
      entry.resource = stats.resourceMax;
    }
    return gained;
  }

  function startBattle(address, zoneId, mobId) {
    const entry = requirePlayer(address);
    if (entry.battle) throw new GameError('Finish the current battle first.', 409);
    const zone = zoneById(zoneId);
    if (!zone) throw new GameError('Unknown zone.', 404);
    if (entry.level < zone.minLevel) throw new GameError('This zone is not open to you yet.', 409);
    const isBoss = zone.boss.id === mobId;
    const mob = isBoss ? zone.boss : zone.mobs.find((item) => item.id === mobId);
    if (!mob) throw new GameError('Unknown enemy.', 404);
    if (mob.requiresQuest && entry.quests[mob.requiresQuest] !== 'done') {
      const prerequisite = QUEST_BY_ID.get(mob.requiresQuest);
      throw new GameError(`Requires ${prerequisite ? prerequisite.name : mob.requiresQuest}.`, 409);
    }
    const stats = playerStats(entry);
    if (entry.hp <= 0) entry.hp = Math.round(stats.maxHp * 0.4);

    entry.battle = {
      id: randomBytes(12).toString('hex'),
      zoneId,
      mobId,
      kind: isBoss ? 'boss' : 'mob',
      turn: 1,
      status: 'active',
      enemy: {
        id: mob.id,
        name: mob.name,
        art: mob.art,
        level: mob.level,
        hp: mob.hp,
        maxHp: mob.hp,
        min: mob.min,
        max: mob.max,
        armor: mob.armor,
        xp: mob.xp,
        sumo: mob.sumo,
        loot: mob.loot ?? [],
        special: mob.special ?? null,
      },
      playerHp: entry.hp,
      playerResource: entry.resource,
      shield: 0,
      buffs: { attackPct: 0, spellPct: 0, nextAttack: 1, turns: 0, weakenPct: 0, weakenTurns: 0, playerWeakenPct: 0, playerWeakenTurns: 0 },
      dots: { player: [], enemy: [] },
      hots: { player: [] },
      stun: { player: 0, enemy: 0 },
      cooldowns: {},
      log: [{ kind: 'system', text: `${mob.name} blocks your path.` }],
      startedAt: Date.now(),
    };
    save(address, entry);
    return overview(address);
  }

  function act(address, abilityId, itemId) {
    const entry = requirePlayer(address);
    const battle = entry.battle;
    if (!battle || battle.status !== 'active') throw new GameError('There is no active battle.', 409);
    battle.buffs.playerWeakenPct ??= 0;
    battle.buffs.playerWeakenTurns ??= 0;
    const klass = classById(entry.className);
    if (abilityId === 'defend') {
      if (battle.stun.player > 0) {
        battle.log.push({ kind: 'system', text: 'You are stunned and lose the turn.' });
        battle.stun.player -= 1;
      } else {
        const stats = playerStats(entry);
        const gained = Math.round(stats.armor * 0.6 + 8);
        battle.shield += gained;
        battle.playerResource = Math.min(stats.resourceMax, battle.playerResource + Math.round(stats.resourceRegen * 0.8));
        battle.log.push({ kind: 'buff', text: `You brace behind your guard, absorbing ${gained} damage.` });
      }
    } else if (itemId) {
      useItemInBattle(entry, battle, itemId);
    } else {
      const ability = abilityId === 'attack' ? null : abilityById(abilityId);
      if (abilityId !== 'attack' && !ability) throw new GameError('Unknown ability.', 404);
      if (ability && !klass.abilities.includes(ability.id)) throw new GameError('Your class cannot use that ability.', 409);
      if (battle.stun.player > 0) {
        battle.log.push({ kind: 'system', text: 'You are stunned and lose the turn.' });
        battle.stun.player -= 1;
      } else if (ability) {
        const cooldown = battle.cooldowns[ability.id] ?? 0;
        if (cooldown > 0) throw new GameError(`${ability.name} is on cooldown.`, 409);
        if (battle.playerResource < ability.cost) throw new GameError('Not enough resource.', 409);
        battle.playerResource -= ability.cost;
        if (ability.cooldown > 0) battle.cooldowns[ability.id] = ability.cooldown + 1;
        applyPlayerAbility(entry, battle, ability, klass);
      } else {
        basicAttack(entry, battle, klass);
      }
    }

    if (battle.enemy.hp > 0 && battle.status === 'active') enemyTurn(entry, battle);
    if (battle.enemy.hp <= 0) winBattle(entry, battle);
    else if (battle.playerHp <= 0) loseBattle(entry, battle);
    else endTurn(entry, battle);
    save(address, entry);
    return overview(address);
  }

  function applyPlayerAbility(entry, battle, ability, klass) {
    const stats = playerStats(entry);
    const attackBuff = 1 + battle.buffs.attackPct;
    const spellBuff = 1 + battle.buffs.spellPct;
    const next = battle.buffs.nextAttack || 1;
    if (ability.type === 'damage') {
      const physical = ability.school === 'physical';
      const hitChance = physical ? 1 - swingMissChance(entry.level, battle.enemy.level, false) : spellHitChance(entry.level, battle.enemy.level);
      if (Math.random() > hitChance) {
        battle.log.push({ kind: 'miss', text: physical ? `${ability.name} misses ${battle.enemy.name}.` : `${battle.enemy.name} resists ${ability.name}.` });
        battle.buffs.nextAttack = 1;
        return;
      }
      let amount = randomInt(ability.min, ability.max + 1);
      const power = physical ? stats.attack : stats.spell;
      amount += Math.round(power * (physical ? 0.4 : 0.55) * (physical ? attackBuff : spellBuff));
      if (ability.execute && battle.enemy.hp <= battle.enemy.maxHp * 0.3) amount *= 2;
      amount = Math.round(amount * next);
      if (battle.buffs.playerWeakenTurns > 0) {
        amount = Math.max(1, Math.round(amount * (1 - battle.buffs.playerWeakenPct)));
      }
      battle.buffs.nextAttack = 1;
      const { dealt, crit } = rollDamage(
        amount,
        stats.crit / 100,
        physical ? 2 : 1.5,
        physical ? armorReduction(battle.enemy.armor, entry.level) : 0,
      );
      battle.enemy.hp = Math.max(0, battle.enemy.hp - dealt);
      battle.log.push({ kind: crit ? 'crit' : 'damage', text: `${ability.name} hits ${battle.enemy.name} for ${dealt}${crit ? ' (critical)' : ''}.`, amount: dealt });
      if (ability.drain && dealt > 0) {
        const healed = Math.min(stats.maxHp - battle.playerHp, Math.round(dealt * ability.drain));
        if (healed > 0) {
          battle.playerHp += healed;
          battle.log.push({ kind: 'heal', text: `${ability.name} drains ${healed} health back to you.`, amount: healed });
        }
      }
      if (ability.dot) {
      battle.dots.enemy.push({
        perTurn: Math.max(1, Math.round(ability.dot.total / ability.dot.turns)),
        left: ability.dot.turns,
        name: ability.name,
      });
    }
      if (ability.stun) battle.stun.enemy = Math.max(battle.stun.enemy, ability.stun);
      if (ability.weaken) {
        battle.buffs.weakenPct = ability.weaken.pct;
        battle.buffs.weakenTurns = ability.weaken.turns;
      }
      if (ability.gain) battle.playerResource = Math.min(stats.resourceMax, battle.playerResource + ability.gain);
    } else if (ability.type === 'heal') {
      const amount = ability.pct ? Math.round(stats.maxHp * ability.pct) : randomInt(ability.min, ability.max + 1);
      const healed = Math.min(stats.maxHp - battle.playerHp, amount);
      battle.playerHp += healed;
      battle.log.push({ kind: 'heal', text: `${ability.name} restores ${healed} health.`, amount: healed });
    } else if (ability.type === 'shield') {
      battle.shield += ability.amount;
      battle.log.push({ kind: 'buff', text: `${ability.name} absorbs up to ${ability.amount} damage.` });
    } else if (ability.type === 'hot') {
      battle.hots.player.push({
        perTurn: Math.max(1, Math.round(ability.total / ability.turns)),
        left: ability.turns,
        name: ability.name,
      });
      battle.log.push({ kind: 'heal', text: `${ability.name} will heal over ${ability.turns} turns.` });
    } else if (ability.type === 'stun') {
      battle.stun.enemy = Math.max(battle.stun.enemy, ability.turns ?? 1);
      battle.log.push({ kind: 'buff', text: `${ability.name} terrifies ${battle.enemy.name}, stunning it.` });
    } else if (ability.type === 'buff') {
      if (ability.buff === 'attackPct') battle.buffs.attackPct = ability.value;
      if (ability.buff === 'spellPct') battle.buffs.spellPct = ability.value;
      if (ability.buff === 'nextAttack') battle.buffs.nextAttack = ability.value;
      battle.buffs.turns = Math.max(battle.buffs.turns, ability.turns);
      battle.log.push({ kind: 'buff', text: `${ability.name} empowers you for ${ability.turns} turns.` });
    }
  }

  function applyDamageToEnemy(battle, amount, attackerLevel, ignoreArmor = false) {
    const mitigation = ignoreArmor ? 0 : armorReduction(battle.enemy.armor, attackerLevel);
    const dealt = Math.max(1, Math.round(amount * (1 - mitigation)));
    battle.enemy.hp = Math.max(0, battle.enemy.hp - dealt);
    return dealt;
  }

  function basicAttack(entry, battle, klass) {
    const stats = playerStats(entry);
    const buff = 1 + battle.buffs.attackPct;
    const next = battle.buffs.nextAttack || 1;
    battle.buffs.nextAttack = 1;
    if (Math.random() < swingMissChance(entry.level, battle.enemy.level, false)) {
      battle.log.push({ kind: 'miss', text: `You miss ${battle.enemy.name}.` });
      return;
    }
    let amount = randomInt(Math.round(stats.attack * 0.7), Math.round(stats.attack * 1.1) + 1);
    amount = Math.round(amount * buff * next);
    if (battle.buffs.playerWeakenTurns > 0) {
      amount = Math.max(1, Math.round(amount * (1 - battle.buffs.playerWeakenPct)));
    }
    const { dealt, crit } = rollDamage(amount, stats.crit / 100, 2, armorReduction(battle.enemy.armor, entry.level));
    battle.enemy.hp = Math.max(0, battle.enemy.hp - dealt);
    battle.log.push({ kind: crit ? 'crit' : 'damage', text: `You strike ${battle.enemy.name} for ${dealt}${crit ? ' (critical)' : ''}.`, amount: dealt });
    const gain = klass.resource === 'rage' ? 14 : klass.resource === 'energy' ? 12 : 8;
    battle.playerResource = Math.min(stats.resourceMax, battle.playerResource + gain);
  }

  function useItemInBattle(entry, battle, itemId) {
    const item = ITEMS[itemId];
    if (!item) throw new GameError('Unknown item.', 404);
    if ((entry.inventory[itemId] ?? 0) <= 0) throw new GameError('You do not carry that item.', 409);
    if (!item.heal && !item.restore) throw new GameError('That item cannot be used in battle.', 409);
    entry.inventory[itemId] -= 1;
    if (entry.inventory[itemId] <= 0) delete entry.inventory[itemId];
    const stats = playerStats(entry);
    if (item.heal) {
      const healed = Math.min(stats.maxHp - battle.playerHp, item.heal);
      battle.playerHp += healed;
      battle.log.push({ kind: 'heal', text: `You use ${item.name} and recover ${healed} health.`, amount: healed });
    }
    if (item.restore) {
      const restored = Math.min(stats.resourceMax - battle.playerResource, item.restore);
      battle.playerResource += restored;
      battle.log.push({ kind: 'buff', text: `You use ${item.name} and recover ${restored} ${classById(entry.className).resourceName.toLowerCase()}.` });
    }
  }

  function enemyTurn(entry, battle) {
    const stats = playerStats(entry);
    if (battle.stun.enemy > 0) {
      battle.stun.enemy -= 1;
      battle.log.push({ kind: 'system', text: `${battle.enemy.name} is stunned and loses the turn.` });
      return;
    }
    const enemy = battle.enemy;
    if (Math.random() < swingMissChance(enemy.level, entry.level, true)) {
      battle.log.push({ kind: 'miss', text: `${enemy.name} misses you.` });
      return;
    }
    const weakened = battle.buffs.weakenTurns > 0 ? 1 - battle.buffs.weakenPct : 1;
    const special = enemy.special && randomInt(0, 100) < Math.round((enemy.special.chance ?? 0.3) * 100);
    let amount = special
      ? randomInt(enemy.special.min, enemy.special.max + 1)
      : randomInt(enemy.min, enemy.max + 1);
    amount = Math.round(amount * weakened);
    const mitigation = mobArmorReduction(stats.armor, enemy.level, entry.level);
    const crit = Math.random() < 0.05;
    let dealt = Math.max(1, Math.round(amount * (crit ? 2 : 1) * (1 - mitigation)));
    if (battle.shield > 0) {
      const absorbed = Math.min(battle.shield, dealt);
      battle.shield -= absorbed;
      dealt -= absorbed;
      if (absorbed > 0) battle.log.push({ kind: 'buff', text: `Your shield absorbs ${absorbed} damage.` });
    }
    if (dealt > 0) {
      battle.playerHp = Math.max(0, battle.playerHp - dealt);
      battle.log.push({ kind: 'hurt', text: `${enemy.name} ${special ? `uses ${enemy.special.name} and ` : ''}hits you for ${dealt}.`, amount: dealt });
    }
    if (special && enemy.special.stun) battle.stun.player = Math.max(battle.stun.player, enemy.special.stun);
    if (special && enemy.special.dot) {
      battle.dots.player.push({
        perTurn: Math.max(1, Math.round(enemy.special.dot.total / enemy.special.dot.turns)),
        left: enemy.special.dot.turns,
        name: enemy.name,
      });
    }
    if (special && enemy.special.weaken) {
      battle.buffs.playerWeakenPct = enemy.special.weaken.pct;
      battle.buffs.playerWeakenTurns = enemy.special.weaken.turns;
    }
    if (classById(entry.className).resource === 'rage') {
      battle.playerResource = Math.min(stats.resourceMax, battle.playerResource + 8);
    }
  }

  function endTurn(entry, battle) {
    const stats = playerStats(entry);
    tickDots(battle, 'enemy', (amount) => {
      const dealt = applyDamageToEnemy(battle, amount, entry.level);
      battle.log.push({ kind: 'damage', text: `Lingering damage hits ${battle.enemy.name} for ${dealt}.`, amount: dealt });
    });
    tickDots(battle, 'player', (amount) => {
      battle.playerHp = Math.max(0, battle.playerHp - amount);
      battle.log.push({ kind: 'hurt', text: `Lingering damage hits you for ${amount}.`, amount });
    });
    tickHots(entry, battle);
    if (battle.buffs.turns > 0) {
      battle.buffs.turns -= 1;
      if (battle.buffs.turns === 0) {
        battle.buffs.attackPct = 0;
        battle.buffs.spellPct = 0;
      }
    }
    if (battle.buffs.weakenTurns > 0) battle.buffs.weakenTurns -= 1;
    if (battle.buffs.playerWeakenTurns > 0) battle.buffs.playerWeakenTurns -= 1;
    for (const [id, turns] of Object.entries(battle.cooldowns)) {
      if (turns <= 1) delete battle.cooldowns[id];
      else battle.cooldowns[id] = turns - 1;
    }
    battle.playerResource = Math.min(stats.resourceMax, battle.playerResource + stats.resourceRegen);
    battle.turn += 1;
    entry.hp = battle.playerHp;
    entry.resource = battle.playerResource;
    if (battle.enemy.hp <= 0) winBattle(entry, battle);
    else if (battle.playerHp <= 0) loseBattle(entry, battle);
  }

  function tickDots(battle, side, apply) {
    const remaining = [];
    for (const dot of battle.dots[side]) {
      apply(dot.perTurn);
      dot.left -= 1;
      if (dot.left > 0) remaining.push(dot);
    }
    battle.dots[side] = remaining;
  }

  function tickHots(entry, battle) {
    const stats = playerStats(entry);
    const remaining = [];
    for (const hot of battle.hots.player) {
      const healed = Math.min(stats.maxHp - battle.playerHp, hot.perTurn);
      battle.playerHp += healed;
      battle.log.push({ kind: 'heal', text: `${hot.name} restores ${healed} health.`, amount: healed });
      hot.left -= 1;
      if (hot.left > 0) remaining.push(hot);
    }
    battle.hots.player = remaining;
  }

  function winBattle(entry, battle) {
    battle.status = 'won';
    entry.hp = battle.playerHp;
    entry.resource = battle.playerResource;
    creditQuestObjectives(entry, battle.mobId);
    let conquest = 0;
    if (battle.kind === 'mob') {
      entry.kills[battle.mobId] = (entry.kills[battle.mobId] ?? 0) + 1;
    } else if (!entry.bosses.includes(battle.zoneId)) {
      entry.bosses.push(battle.zoneId);
      conquest = CONQUEST_BONUS[battle.zoneId] ?? 0;
    }
    const loot = [];
    for (const drop of battle.enemy.loot) {
      if (randomInt(0, 1000) / 1000 <= drop.chance) {
        entry.inventory[drop.itemId] = (entry.inventory[drop.itemId] ?? 0) + 1;
        loot.push(drop.itemId);
      }
    }
    const result = grant(entry, { xp: battle.enemy.xp, sumo: battle.enemy.sumo + conquest });
    const zoneName = ZONES.find((zone) => zone.id === battle.zoneId)?.name;
    entry.lastResult = {
      kind: 'victory',
      title: `${battle.enemy.name} defeated`,
      message: conquest > 0
        ? `Victory in ${battle.turn} turns. ${zoneName ?? 'The zone'} is conquered, and its people pay tribute.`
        : `Victory in ${battle.turn} turns.`,
      xp: result.xp,
      sumo: result.sumo,
      items: result.items,
      levels: result.levels,
      loot,
      conquest,
    };
    entry.battle = null;
  }

  function loseBattle(entry, battle) {
    battle.status = 'lost';
    const stats = playerStats(entry);
    entry.hp = Math.max(1, Math.round(stats.maxHp * 0.4));
    entry.resource = Math.round(stats.resourceMax * 0.3);
    entry.lastResult = {
      kind: 'defeat',
      title: `Defeated by ${battle.enemy.name}`,
      message: 'You wake at the roadside. Rest, resupply, and try again.',
      xp: 0,
      sumo: 0,
      items: {},
      levels: 0,
      loot: [],
    };
    entry.battle = null;
  }

  function resolveBattle(address, payload = {}) {
    const entry = requirePlayer(address);
    const battle = entry.battle;
    if (!battle) throw new GameError('There is no active battle.', 409);
    if (!battle.id || battle.id !== payload.battleId) throw new GameError('That battle is no longer active.', 409);
    const outcome = payload.outcome;
    if (outcome !== 'victory' && outcome !== 'defeat') throw new GameError('Unknown battle outcome.', 400);
    const durationMs = Number(payload.durationMs);
    const hits = Number(payload.hits);
    if (!Number.isFinite(durationMs) || durationMs < 1500 || durationMs > 3600000) {
      throw new GameError('That fight length cannot be trusted.', 409);
    }
    if (!Number.isInteger(hits) || hits < 0 || hits > 2000) {
      throw new GameError('Malformed combat report.', 400);
    }
    const stats = playerStats(entry);
    const reportedHp = Number(payload.playerHp);
    const hp = Number.isFinite(reportedHp) ? Math.min(stats.maxHp, Math.max(1, Math.round(reportedHp))) : stats.maxHp;
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 12) : [];
    for (const itemId of items) {
      if (typeof itemId !== 'string') continue;
      const count = entry.inventory[itemId] ?? 0;
      if (count <= 0) continue;
      if (count - 1 <= 0) delete entry.inventory[itemId];
      else entry.inventory[itemId] = count - 1;
    }
    battle.playerHp = outcome === 'victory' ? hp : 0;
    battle.playerResource = Math.max(0, Math.min(stats.resourceMax, Number(payload.resource) || battle.playerResource));
    if (outcome === 'victory') winBattle(entry, battle);
    else loseBattle(entry, battle);
    save(address, entry);
    return overview(address);
  }

  function flee(address) {
    const entry = requirePlayer(address);
    if (!entry.battle) throw new GameError('There is no active battle.', 409);
    entry.battle = null;
    entry.lastResult = { kind: 'flee', title: 'You retreat', message: 'A tactical withdrawal. The enemy remains.', xp: 0, sumo: 0, items: {}, levels: 0, loot: [] };
    save(address, entry);
    return overview(address);
  }

  function rest(address) {
    const entry = requirePlayer(address);
    if (entry.battle) throw new GameError('You cannot rest during a battle.', 409);
    const stats = playerStats(entry);
    entry.hp = stats.maxHp;
    entry.resource = stats.resourceMax;
    entry.lastResult = null;
    save(address, entry);
    return overview(address);
  }

  function useItem(address, itemId) {
    const entry = requirePlayer(address);
    const item = ITEMS[itemId];
    if (!item) throw new GameError('Unknown item.', 404);
    if ((entry.inventory[itemId] ?? 0) <= 0) throw new GameError('You do not carry that item.', 409);
    if (!item.heal && !item.restore) throw new GameError('That item cannot be used.', 409);
    const stats = playerStats(entry);
    entry.inventory[itemId] -= 1;
    if (entry.inventory[itemId] <= 0) delete entry.inventory[itemId];
    if (item.heal) entry.hp = Math.min(stats.maxHp, entry.hp + item.heal);
    if (item.restore) entry.resource = Math.min(stats.resourceMax, entry.resource + item.restore);
    save(address, entry);
    return overview(address);
  }

  function equip(address, itemId) {
    const entry = requirePlayer(address);
    if (entry.battle) throw new GameError('Finish the battle before changing gear.', 409);
    const item = ITEMS[itemId];
    if (!item) throw new GameError('Unknown item.', 404);
    if (!item.slot) throw new GameError('That item cannot be equipped.', 409);
    if ((entry.inventory[itemId] ?? 0) <= 0) throw new GameError('You do not carry that item.', 409);
    if (item.reqLevel && entry.level < item.reqLevel) throw new GameError(`Requires level ${item.reqLevel}.`, 409);
    entry.equipment ??= {};
    const previous = entry.equipment[item.slot];
    entry.inventory[itemId] -= 1;
    if (entry.inventory[itemId] <= 0) delete entry.inventory[itemId];
    if (previous) entry.inventory[previous] = (entry.inventory[previous] ?? 0) + 1;
    entry.equipment[item.slot] = itemId;
    const stats = playerStats(entry);
    entry.hp = Math.min(entry.hp, stats.maxHp);
    entry.resource = Math.min(entry.resource, stats.resourceMax);
    save(address, entry);
    return overview(address);
  }

  function unequip(address, slot) {
    const entry = requirePlayer(address);
    if (entry.battle) throw new GameError('Finish the battle before changing gear.', 409);
    const itemId = entry.equipment?.[slot];
    if (!itemId) throw new GameError('Nothing is equipped in that slot.', 409);
    delete entry.equipment[slot];
    entry.inventory[itemId] = (entry.inventory[itemId] ?? 0) + 1;
    const stats = playerStats(entry);
    entry.hp = Math.min(entry.hp, stats.maxHp);
    entry.resource = Math.min(entry.resource, stats.resourceMax);
    save(address, entry);
    return overview(address);
  }

  function plant(address, index, cropId) {
    const entry = requirePlayer(address);
    if (entry.battle) throw new GameError('The homestead waits until the fight is over.', 409);
    const crop = CROPS[cropId];
    if (!crop) throw new GameError('Unknown crop.', 404);
    if (![0, 1, 2].includes(Number(index))) throw new GameError('Unknown plot.', 404);
    entry.farm ??= { plots: [] };
    const existing = entry.farm.plots.find((plot) => plot.index === Number(index));
    if (existing) throw new GameError('That plot is already planted.', 409);
    entry.farm.plots.push({ index: Number(index), cropId, plantedAt: Date.now(), readyAt: Date.now() + crop.growMs });
    save(address, entry);
    return overview(address);
  }

  function harvest(address, index) {
    const entry = requirePlayer(address);
    entry.farm ??= { plots: [] };
    const plot = entry.farm.plots.find((item) => item.index === Number(index));
    if (!plot) throw new GameError('Nothing is planted there.', 409);
    if (Date.now() < plot.readyAt) throw new GameError('That crop is still growing.', 409);
    const crop = CROPS[plot.cropId];
    entry.inventory[crop.yield.itemId] = (entry.inventory[crop.yield.itemId] ?? 0) + crop.yield.count;
    entry.farm.plots = entry.farm.plots.filter((item) => item !== plot);
    entry.lastResult = {
      kind: 'harvest',
      title: `${crop.name} harvested`,
      message: `You gather ${crop.yield.count} ${ITEMS[crop.yield.itemId]?.name ?? crop.yield.itemId}.`,
      xp: 0, sumo: 0, items: { [crop.yield.itemId]: crop.yield.count }, levels: 0, loot: [],
    };
    save(address, entry);
    return overview(address);
  }

  return {
    overview,
    chooseClass,
    acceptQuest,
    turnInQuest,
    startBattle,
    act,
    resolveBattle,
    flee,
    rest,
    useItem,
    equip,
    unequip,
    plant,
    harvest,
  };
}
