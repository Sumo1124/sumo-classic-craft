import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameStore } from '../backend/store.mjs';
import { createAdventure, CLASSES, ZONES, ITEMS, CROPS } from '../backend/adventure.mjs';

const HERO = `0x${'c'.repeat(40)}`;
const OTHER = `0x${'d'.repeat(40)}`;

function setup() {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-adventure-')), 'game.json');
  const store = createGameStore(file);
  return { file, store, adventure: createAdventure({ store }) };
}

function play(address, adventure, abilityId = 'attack', maxTurns = 90) {
  let view = adventure.overview(address);
  let turns = 0;
  while (view.battle && turns < maxTurns) {
    view = adventure.act(address, abilityId);
    turns += 1;
  }
  return view;
}

test('an unwritten wallet sees every class and no player', () => {
  const { adventure } = setup();
  const view = adventure.overview(HERO);
  assert.equal(view.player, null);
  assert.equal(view.battle, null);
  assert.equal(view.farm, null);
  assert.equal(view.classes.length, CLASSES.length);
  assert.deepEqual(view.classes.map((klass) => klass.id).sort(), CLASSES.map((klass) => klass.id).sort());
  assert.ok(view.classes.every((klass) => klass.portrait.startsWith('/woc/classes/')));
  assert.deepEqual(view.items.baked_bread, { name: ITEMS.baked_bread.name, icon: ITEMS.baked_bread.icon });
  assert.ok(view.zones.some((zone) => zone.id === 'eastbrook-vale' && zone.unlocked === false));
});

test('a wallet chooses exactly one class and receives starter supplies', () => {
  const { adventure } = setup();
  assert.throws(() => adventure.chooseClass('nope', 'warrior'), /valid wallet address/i);
  assert.throws(() => adventure.chooseClass(HERO, 'bard'), /Unknown class/i);

  const view = adventure.chooseClass(HERO, 'warrior');
  assert.equal(view.player.className, 'warrior');
  assert.equal(view.player.level, 1);
  assert.equal(view.player.hp, view.player.maxHp);
  assert.equal(view.classes.length, 0);
  assert.deepEqual(view.player.abilities.map((ability) => ability.id), CLASSES[0].abilities);
  assert.deepEqual(
    view.inventory.map((item) => [item.id, item.count]).sort(),
    [['baked_bread', 2], ['spring_water', 2]],
  );
  assert.throws(() => adventure.chooseClass(HERO, 'mage'), /already chosen/i);
});

test('zones unlock by level and unknown quests are rejected', () => {
  const { adventure } = setup();
  adventure.chooseClass(HERO, 'mage');
  const view = adventure.acceptQuest(HERO, 'q_wolves');
  assert.equal(view.zones.find((zone) => zone.id === 'eastbrook-vale').quests
    .find((quest) => quest.id === 'q_wolves').state, 'active');
  assert.throws(() => adventure.acceptQuest(HERO, 'q_marsh_murlocs'), /not open to you yet/i);
  assert.throws(() => adventure.acceptQuest(HERO, 'q_missing'), /Unknown quest/i);
  assert.throws(() => adventure.acceptQuest(HERO, 'q_spiders'), /Requires level 2/i);
});

test('a battle rejects foreign abilities, double starts and forged turns', () => {
  const { adventure } = setup();
  adventure.chooseClass(HERO, 'warrior');
  assert.throws(() => adventure.act(HERO, 'attack'), /no active battle/i);
  assert.throws(() => adventure.startBattle(HERO, 'drakelands', 'korzul'), /not open to you yet/i);

  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  assert.throws(() => adventure.startBattle(HERO, 'eastbrook-vale', 'thicket_boar'), /current battle/i);
  assert.throws(() => adventure.act(HERO, 'cinderbolt'), /cannot use that ability/i);
  assert.throws(() => adventure.act(HERO, 'not_an_ability'), /Unknown ability/i);

  const retreated = adventure.flee(HERO);
  assert.equal(retreated.battle, null);
  assert.equal(retreated.lastResult.kind, 'flee');
  assert.throws(() => adventure.flee(HERO), /no active battle/i);
});

test('victory awards mob xp and SUMO once and records the kill', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'warrior');
  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  const view = play(HERO, adventure);
  assert.equal(view.battle, null);
  assert.equal(view.lastResult.kind, 'victory');
  assert.equal(view.lastResult.sumo, 6);
  assert.equal(view.player.sumoEarned, 6);
  assert.equal(store.progress(HERO).localBalance, 6);
  assert.equal(store.getAdventure(HERO).kills.forest_wolf, 1);
  assert.equal(view.lastResult.loot.every((itemId) => itemId in ITEMS), true);
});

test('the enemy always answers, and a lost battle still restores the player', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'mage');
  adventure.startBattle(HERO, 'eastbrook-vale', 'vale_bandit');
  const view = play(HERO, adventure);
  assert.ok(['victory', 'defeat'].includes(view.lastResult.kind));
  const entry = store.getAdventure(HERO);
  assert.ok(entry.hp > 0);
  assert.equal(entry.battle, null);
});

test('kill quests only pay out once the objective is met', () => {
  const { adventure } = setup();
  adventure.chooseClass(HERO, 'warrior');
  adventure.acceptQuest(HERO, 'q_wolves');
  assert.throws(() => adventure.turnInQuest(HERO, 'q_wolves'), /not complete yet/i);

  const wolfQuest = () => adventure.overview(HERO).zones.find((zone) => zone.id === 'eastbrook-vale')
    .quests.find((item) => item.id === 'q_wolves');
  let attempts = 0;
  while (wolfQuest().current < 7 && attempts < 25) {
    adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
    play(HERO, adventure);
    attempts += 1;
  }

  const quest = wolfQuest();
  assert.equal(quest.current, 7);
  assert.equal(quest.canTurnIn, false);
  assert.throws(() => adventure.turnInQuest(HERO, 'q_wolves'), /not complete yet/i);

  while (wolfQuest().current < 8 && attempts < 40) {
    adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
    play(HERO, adventure);
    attempts += 1;
  }

  const sumoBefore = adventure.overview(HERO).player.sumoEarned;
  const paid = adventure.turnInQuest(HERO, 'q_wolves');
  const done = paid.zones.find((zone) => zone.id === 'eastbrook-vale').quests
    .find((item) => item.id === 'q_wolves');
  assert.equal(done.state, 'done');
  assert.equal(done.current, 8);
  assert.equal(paid.lastResult.kind, 'quest');
  assert.equal(paid.lastResult.sumo, 75);
  assert.equal(paid.player.sumoEarned, sumoBefore + 75);
  assert.equal(paid.inventory.find((item) => item.id === 'baked_bread').count, 2);
  assert.throws(() => adventure.turnInQuest(HERO, 'q_wolves'), /already completed/i);
  assert.equal(paid.zones.find((zone) => zone.id === 'eastbrook-vale').quests
    .find((item) => item.id === 'q_greyjaw').state, 'available');
});

test('collect quests consume the delivered items', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'hunter');
  adventure.acceptQuest(HERO, 'q_boars');
  const entry = store.getAdventure(HERO);
  entry.inventory.boar_hide = 6;
  store.saveAdventure(HERO, entry);

  const paid = adventure.turnInQuest(HERO, 'q_boars');
  const inventory = Object.fromEntries(paid.inventory.map((item) => [item.id, item.count]));
  assert.equal(inventory.boar_hide, 1);
  assert.equal(paid.lastResult.xp, 350);
  assert.equal(paid.lastResult.sumo, 120);
});

test('boss battles are flagged and defeat marks the zone cleared', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'paladin');
  const entry = store.getAdventure(HERO);
  entry.level = 6;
  entry.hp = 999;
  entry.resource = 999;
  entry.quests.q_rite = 'done';
  store.saveAdventure(HERO, entry);
  adventure.acceptQuest(HERO, 'q_hollow');

  const started = adventure.startBattle(HERO, 'eastbrook-vale', 'morthen');
  assert.equal(started.battle.kind, 'boss');
  const bossView = started.zones.find((zone) => zone.id === 'eastbrook-vale').boss;
  assert.equal(bossView.defeated, false);
  assert.equal(bossView.title, 'The Gravecaller of Eastbrook');
  assert.ok(bossView.taunt.length > 0);
  const view = play(HERO, adventure);
  if (view.lastResult.kind === 'victory') {
    assert.equal(view.lastResult.conquest, 25);
    assert.equal(view.zones.find((zone) => zone.id === 'eastbrook-vale').cleared, true);
    assert.equal(view.zones.find((zone) => zone.id === 'eastbrook-vale')
      .quests.find((quest) => quest.id === 'q_hollow').current, 1);
  } else {
    assert.equal(view.lastResult.kind, 'defeat');
  }
  assert.equal(view.battle, null);
});

test('quest gating enforces prerequisites and class restrictions', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'warrior');
  assert.throws(() => adventure.acceptQuest(HERO, 'q_greyjaw'), /Requires Wolves at the Door/i);
  assert.throws(() => adventure.startBattle(HERO, 'eastbrook-vale', 'morthen'), /Requires The Binding Rite/i);

  const view = adventure.overview(HERO);
  const eastbrook = view.zones.find((zone) => zone.id === 'eastbrook-vale');
  const tome = eastbrook.quests.find((quest) => quest.id === 'q_divine_tome');
  const entry = store.getAdventure(HERO);
  entry.level = 6;
  entry.quests.q_bones = 'done';
  store.saveAdventure(HERO, entry);
  const locked = adventure.overview(HERO).zones.find((zone) => zone.id === 'eastbrook-vale')
    .quests.find((quest) => quest.id === 'q_divine_tome');
  assert.equal(tome.state, 'locked');
  assert.equal(locked.state, 'locked');
  assert.match(locked.lockedReason, /Only Paladin/i);
});

test('consumables heal in and out of battle and cannot be used up twice', () => {
  const { adventure } = setup();
  adventure.chooseClass(HERO, 'warrior');
  const entryView = adventure.overview(HERO);
  assert.ok(entryView.player.hp > 0);

  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  const used = adventure.act(HERO, null, 'baked_bread');
  assert.equal(used.battle.playerHp > 0, true);
  assert.equal(used.inventory.find((item) => item.id === 'baked_bread').count, 1);
  assert.throws(() => adventure.act(HERO, null, 'wolf_fang'), /carry that item/i);
  adventure.flee(HERO);

  const outside = adventure.useItem(HERO, 'baked_bread');
  assert.equal(outside.inventory.some((item) => item.id === 'baked_bread'), false);
  assert.throws(() => adventure.useItem(HERO, 'baked_bread'), /do not carry/i);
});

test('rest restores health but is refused mid-battle', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'rogue');
  const entry = store.getAdventure(HERO);
  entry.hp = 5;
  entry.resource = 0;
  store.saveAdventure(HERO, entry);

  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  assert.throws(() => adventure.rest(HERO), /during a battle/i);
  adventure.flee(HERO);

  const rested = adventure.rest(HERO);
  assert.equal(rested.player.hp, rested.player.maxHp);
  assert.equal(rested.player.resource, rested.player.resourceMax);
});

test('the homestead plants one crop per plot and harvests only mature crops', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'priest');
  assert.equal(adventure.overview(HERO).farm.plots.length, 3);

  const planted = adventure.plant(HERO, 0, 'vale_wheat');
  assert.equal(planted.farm.plots[0].crop.id, 'vale_wheat');
  assert.equal(planted.farm.plots[0].ready, false);
  assert.throws(() => adventure.plant(HERO, 0, 'sunroot'), /already planted/i);
  assert.throws(() => adventure.plant(HERO, 3, 'vale_wheat'), /Unknown plot/i);
  assert.throws(() => adventure.plant(HERO, 1, 'moonflower'), /Unknown crop/i);
  assert.throws(() => adventure.harvest(HERO, 0), /still growing/i);
  assert.throws(() => adventure.harvest(HERO, 2), /Nothing is planted/i);

  const entry = store.getAdventure(HERO);
  entry.farm.plots[0].readyAt = Date.now() - 1;
  store.saveAdventure(HERO, entry);

  const harvested = adventure.harvest(HERO, 0);
  assert.equal(harvested.farm.plots[0].crop, null);
  assert.equal(harvested.lastResult.kind, 'harvest');
  assert.equal(harvested.inventory.find((item) => item.id === 'baked_bread').count, 4);
  assert.equal(harvested.lastResult.items[CROPS.vale_wheat.yield.itemId], CROPS.vale_wheat.yield.count);
});

test('adventure progress survives a store restart and counts once in the balance', () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sumo-adventure-')), 'game.json');
  const first = createGameStore(file);
  const adventure = createAdventure({ store: first });
  adventure.chooseClass(HERO, 'warrior');
  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  play(HERO, adventure);
  const earned = first.getAdventure(HERO).sumoEarned;
  assert.ok(earned > 0);

  const second = createGameStore(file);
  const restored = createAdventure({ store: second });
  const view = restored.overview(HERO);
  assert.equal(view.player.sumoEarned, earned);
  assert.equal(second.progress(HERO).localBalance, earned);
  assert.equal(view.localBalance, earned);
  assert.equal(second.getAdventure(OTHER), null);
  assert.ok(view.zones.every((zone) => zone.quests.every((quest) => ['available', 'locked'].includes(quest.state))));
  assert.equal(ZONES.length, 5);
});

test('equipment swaps stats in and out and respects level and battle rules', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'warrior');
  const before = adventure.overview(HERO);
  const entry = store.getAdventure(HERO);
  entry.inventory.worn_sword = 1;
  entry.inventory.anvilguard_blade = 1;
  store.saveAdventure(HERO, entry);

  assert.throws(() => adventure.equip(HERO, 'anvilguard_blade'), /Requires level 4/i);
  assert.throws(() => adventure.equip(HERO, 'baked_bread'), /cannot be equipped/i);
  assert.throws(() => adventure.equip(HERO, 'gnarled_staff'), /do not carry/i);

  const equipped = adventure.equip(HERO, 'worn_sword');
  assert.equal(equipped.player.equipment.weapon.id, 'worn_sword');
  assert.equal(equipped.player.attack, before.player.attack + 4);
  assert.equal(equipped.inventory.some((item) => item.id === 'worn_sword'), false);

  const removed = adventure.unequip(HERO, 'weapon');
  assert.equal(removed.player.equipment.weapon, null);
  assert.equal(removed.player.attack, before.player.attack);
  assert.equal(removed.inventory.find((item) => item.id === 'worn_sword').count, 1);
  assert.throws(() => adventure.unequip(HERO, 'weapon'), /Nothing is equipped/i);

  adventure.equip(HERO, 'worn_sword');
  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  assert.throws(() => adventure.unequip(HERO, 'weapon'), /Finish the battle/i);
  assert.throws(() => adventure.equip(HERO, 'anvilguard_blade'), /Finish the battle/i);
  adventure.flee(HERO);
});

test('defend raises a shield and feeds the resource bar', () => {
  const { adventure } = setup();
  adventure.chooseClass(HERO, 'warrior');
  const started = adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  const resource = started.battle.playerResource;
  const view = adventure.act(HERO, 'defend');
  assert.ok(view.battle, 'battle should still be running');
  assert.ok(view.battle.log.some((entry) => /brace behind your guard/i.test(entry.text)));
  assert.ok(view.battle.shield > 0, 'shield should remain after the enemy turn');
  assert.ok(view.battle.playerResource > resource, 'defending should restore resource');
});

test('enemy weakening reduces player damage without weakening the enemy', () => {
  const { adventure, store } = setup();
  adventure.chooseClass(HERO, 'warrior');
  adventure.startBattle(HERO, 'eastbrook-vale', 'forest_wolf');
  const entry = store.getAdventure(HERO);
  Object.assign(entry.battle.enemy, {
    hp: 5000,
    maxHp: 5000,
    min: 1,
    max: 1,
    armor: 0,
    special: {
      name: 'Test Chill', min: 1, max: 1, chance: 1,
      weaken: { pct: 1, turns: 3 },
    },
  });
  store.saveAdventure(HERO, entry);

  const weakened = adventure.act(HERO, 'defend');
  assert.ok(weakened.battle);
  assert.equal(weakened.battle.buffs.playerWeakenPct, 1);
  assert.ok(weakened.battle.buffs.playerWeakenTurns > 0);
  assert.equal(weakened.battle.buffs.weakenPct, 0);
  assert.equal(weakened.battle.buffs.weakenTurns, 0);

  const attacked = adventure.act(HERO, 'attack');
  assert.ok(attacked.battle);
  const hit = attacked.battle.log.find((log) => /^You strike/.test(log.text));
  if (hit) {
    assert.ok(hit.amount <= 2, `weakened attack should deal at most 2 damage, got ${hit.amount}`);
  } else {
    assert.ok(attacked.battle.log.some((log) => /^You miss/.test(log.text)));
  }
});

test('every class, zone, mob and boss points at a real asset', () => {
  const publicDir = path.resolve('public');
  for (const klass of CLASSES) {
    assert.ok(existsSync(path.join(publicDir, klass.portrait)), klass.portrait);
  }
  for (const zone of ZONES) {
    assert.ok(existsSync(path.join(publicDir, zone.art)), zone.art);
    for (const mob of [...zone.mobs, zone.boss]) {
      assert.ok(existsSync(path.join(publicDir, mob.art)), `${zone.id}: ${mob.art}`);
    }
  }
});
