# Spec — Port ClaudeCraft's Eastbrook Vale (quests + combat rules) into World of Carrickcraft

Status: approved — implemented
Source of truth: `C:\Users\hp\Desktop\World of ClaudeCraft v0.45.8 source code\levy-street-world-of-claudecraft-ef93e01`
Target: `c:\Users\hp\Desktop\sumo-web3` (Vite + TS client, Node backend on :8788)

## 1. Objective

Reproduce ClaudeCraft's authored **Eastbrook Vale** quest world and its **combat math** inside this game, keeping this game's
wallet/SUMO economy, server authority, and three.js real-time duel renderer. Not a file transplant: content and rules are ported
into the existing schemas.

Scope decision already made by the user: **Eastbrook Vale first**, then the same pipeline for Mirefen Marsh, Thornpeak Heights,
Drakelands, Willowfen.

## 2. Approved direction / prior context

- The 3D real-time battle (`src/battle3d.ts`) already exists and must be kept; combat *rules* move to ClaudeCraft formulas.
- The server remains authoritative for rewards; the client cannot invent XP/SUMO/items.
- Quest battles still start via `/api/adventure/battle/start` and resolve via `/api/adventure/battle/resolve`.

## 3. Content being ported (Eastbrook Vale)

Authored quests from `src/sim/content/zone1.ts` (`ZONE1_QUESTS`). 19 quests map onto existing mechanics and are in scope:

| Quest id | Name | Giver | Objectives | Requires | Min lvl | Rewards (xp / sumo) |
|---|---|---|---|---|---|---|
| q_wolves | Wolves at the Door | Marshal Redbrook | kill forest_wolf ×8 | — | 1 | 250 / 75 |
| q_greyjaw | The Old Wolf | Marshal Redbrook | collect greyjaw_fang ×1 | q_wolves | 1 | 450 / 150 + class cloak |
| q_boars | Bristly Boar Hides | Trader Wilkes | collect boar_hide ×5 | — | 1 | 350 / 120 |
| q_spiders | Sableweb Menace | Apothecary Lin | kill webwood_spider ×6, collect webwood_silk ×4 | — | 2 | 420 / 140 |
| q_murlocs | Trouble at the Lake | Fisherman Brandt | kill mudfin_murloc ×8 | — | 3 | 520 / 180 |
| q_supplies | Stolen Supplies | Trader Wilkes | collect supply_crate ×4 | — | 3 | 550 / 250 |
| q_mine | Rats in the Mine | Foreman Odell | kill tunnel_rat ×10 | — | 4 | 620 / 220 |
| q_bones | The Restless Dead | Brother Aldric | collect restless_skull ×8 | — | 5 | 700 / 260 + lychgate_buckler |
| q_bandits | Bandits of the Vale | Marshal Redbrook | kill vale_bandit ×10 | q_wolves | — | 550 / 200 + class gear |
| q_ringleader | The Ringleader | Marshal Redbrook | kill gorrak ×1 | q_bandits | — | 800 / 500 + class gear |
| q_whispers | Whispers Below | Brother Aldric | collect gravecaller_sigil ×1 | q_bones | — | 400 / 150 |
| q_names_of_the_dead | The Names of the Dead | Brother Aldric | collect weathered_ledger_page ×3 | q_whispers | — | 600 / 250 |
| q_silence_the_call | Silence the Call | Brother Aldric | kill restless_bones ×12 | q_names_of_the_dead | — | 750 / 300 |
| q_rite | The Binding Rite | Brother Aldric | collect blessed_wax ×4, collect ghostly_essence ×6 | q_whispers | — | 700 / 500 |
| q_hollow | Into the Hollow | Brother Aldric | kill morthen ×1 | q_rite | — | 1500 / 10000 + class weapon |
| q_sexton | The Sexton's Bell | Brother Aldric | kill sexton_marrow ×1 | q_rite | — | 1000 / 600 + class boots |
| q_gravecallers_trail | The Gravecaller's Trail | Brother Aldric | collect morthen_grimoire ×1 | q_hollow | — | 900 / 400 |
| q_divine_tome | The Dawnbound Tome | Brother Aldric | kill restless_bones ×6 | q_bones, paladin only | 6 | 650 / 200 |
| q_mogger | Mogger Must Fall | Marshal Redbrook | kill mogger ×1 | q_gravecallers_trail | 6 | 1200 / 900 + class gear |

Dialogue (`text`, `completionText`) and objective labels are copied verbatim from `zone1.ts` (only `$N` → player class/name is
left as plain text, as the current UI does not template names).

Out of scope for this phase (documented, not silently dropped): `q_prof_intro`, `q_farm_intro`, `q_prof_attune_*`,
`q_prof_amends_*`, `q_prof_workorder_*`, `q_prof_hobby_switch` — they require gathering-node/profession systems this game does
not have. They are listed for phase 2.

### 3.1 Mob / elite additions to `eastbrook-vale`

Add to `ZONES['eastbrook-vale'].mobs` (stats authored to ClaudeCraft proportions, existing `hp/min/max/armor/xp/sumo/loot` shape):

- `mudfin_murloc` L3, `tunnel_rat` L4, `restless_bones` L5, `greyjaw` L5 elite, `gorrak` L6 elite, `mogger` L7 elite,
  `sexton_marrow` L8 elite.
- Zone boss becomes `morthen` "Morthen the Gravecaller" L8 (replaces `barrow_king`) to match the Hollow Crypt chain.
- `zone.boss` gains `requiresQuest: 'q_rite'`; `sexton_marrow` is a mob gated by `q_rite`; `morthen` completes both
  `q_hollow` and the zone conquest.
- Loot tables seed quest items: `greyjaw_fang` (greyjaw), `webwood_silk` (webwood_spider), `restless_skull` +
  `ghostly_essence` (restless_bones), `supply_crate` (vale_bandit), `gravecaller_sigil` (restless_bones, low chance),
  `weathered_ledger_page` (restless_bones), `blessed_wax` (tunnel_rat), `morthen_grimoire` (morthen).

## 4. Backend changes — `app/backend/adventure.mjs`

### 4.1 Quest schema (replaces the current single `objective`)

```js
{
  id, name, npc,                 // npc = display giver name
  text, completionText,
  objectives: [{ type: 'kill'|'elite'|'boss'|'collect', mobId?, itemId?, count, label }],
  requiresQuest?: string,
  minLevel?: number,
  requiredClass?: string[],      // e.g. ['paladin']
  rewards: { xp, sumo, items: {id: count}, classItems?: { warrior:..., mage:..., rogue:... } },
}
```
`classItems` is resolved to one concrete item at turn-in using the role map
(warrior/paladin/shaman → warrior key; mage/priest/warlock/druid → mage key; rogue/hunter → rogue key).

### 4.2 Quest state machine

`entry.questProgress[questId] = { [objectiveIndex]: count }` (new field; `freshPlayer` initialises it).

`objectiveCount(entry, quest, objective, index)`:
- `collect` → `entry.inventory[itemId] ?? 0` (capped at required for display)
- `kill`/`elite`/`boss` → `entry.questProgress[quest.id]?.[index] ?? 0`

`questState(entry, quest)`:
- `done` if `entry.quests[quest.id] === 'done'`
- `locked` if `requiresQuest` not done, level < minLevel, or class not allowed
- `ready` if active and every objective is complete
- `active` if `entry.quests[quest.id] === 'active'`
- otherwise `available`

`questView` returns `{ id, name, npc, text, completionText, objectives:[{label,current,required,done}], current, required,
state, canTurnIn, rewards, lockedReason }` — keep `current/required` as aggregate for backwards UI compatibility.

### 4.3 Credit and validation

- `winBattle`: after recording kills, call `creditQuestObjectives(entry, mobId)` which increments every objective index of every
  **active** quest that targets that mob. Credit only while `entry.quests[id] === 'active'` (ClaudeCraft rule).
- `acceptQuest`: reject unless state is `available`; `locked` returns `409` with `lockedReason`.
- `turnInQuest`: require state `ready`; consume every `collect` objective's items; grant rewards; set `done`; set
  `entry.lastResult` with `title`, `message = quest.completionText`, rewards and level-ups.
- `startBattle`: enforce mob-level gate of `requiresQuest` for `sexton_marrow` / `morthen`; bosses keep the existing zone-level gate.

### 4.4 Items — `ITEMS`

Add quest items (`kind:'quest'`) and reward gear, all referencing existing `/woc/items/*.webp` icons
(no missing assets):
`greyjaw_fang`, `webwood_silk`, `restless_skull`, `supply_crate`, `gravecaller_sigil`, `weathered_ledger_page`,
`blessed_wax`, `ghostly_essence`, `morthen_grimoire`;
`greyjaw_pelt_cloak`, `lychgate_buckler`, `redbrook_blade`, `apprentice_staff`, `keen_dirk`, `militia_vest`, `woven_robe`,
`shadow_jerkin`, `gravecaller_blade`, `widowfang_dirk`, `gravecaller_staff`, `marrowtread_boots`, `sextons_slippers`,
`gravewalker_softboots`, `bristleback_maul`, `sableweb_slippers`, `moggers_stomper_boots`.
Icon reuse map: blades → `anvilguard_blade`, staves → `briarroot_staff`, robes/cloaks → `apprentice_robe`/`wolfhide_satchel`,
boots → `milepost_boots`, shields → `eastbrook_buckler`, quest items → thematic existing icons.

## 5. Combat rules (ClaudeCraft math, applied to the real-time duel and the legacy turn engine)

New `src/combat-rules.ts` (pure functions, imported by `battle3d.ts`); the same functions are duplicated as module-local helpers
in `adventure.mjs` for the turn-based `act` path.

- `aboveLevelMissPct(diff)` = table `[0, 2.5, 8, 14]` (clamped to last).
- `meleeMissChance(attackerLevel, targetLevel)` = diff > 0 ? `5 + above(diff)` : `5 + diff*0.2`; clamp `[0.005, 0.95]`.
- `swingMissChance(attacker, target)` — mob→player capped at `0.2`; player→mob unmodified.
- `spellHitChance` = diff <= 0 ? `96 - diff` : `96 - above(diff)`; clamp `[0.05, 0.99]`; mob→player hit floor 5%.
- `armorReduction(armor, attackerLevel)` = `min(0.75, a / (a + 85*attackerLevel + 400))`, `a = max(0, armor)`.
- `mobArmorReduction(playerArmor, mobLevel, playerLevel)` — when `mobLevel < playerLevel`, cap DR at `0.2`; otherwise uncapped.
- Crit multiplier: physical **×2**, spell **×1.5**. Player crit chance = `8 + gear crit`; hostile mob crit = **5%**.
- Damage shape: `roll(base min..max)` → miss check → crit multiply → armor reduction for physical → `max(1, round(...))`.
- Ability casts use spell hit + spell crit (×1.5) and skip armor when the school is not physical; physical abilities keep armor DR.
- Real-time pacing (`0.5 s` player swing, `0.52 s` mob windup / `0.85 s` recover, ability cooldowns) is **kept**, since it was
  already tuned for the 3D scene; only the rules above change.

### `src/battle3d.ts` integration points

- Replace `playerDamage()` with a rules-based roll using `config.playerLevel`, `config.enemyLevel`, `config.enemyArmor`,
  `config.playerAttack`, `config.playerCrit`.
- Replace `enemyDamage()` with a rules-based roll: `enemyMin..enemyMax`, mob crit 5%, `mobArmorReduction(config.playerArmor, ...)`.
- `resolveHeroStrike()` / `useAbility()` route through the new roll; log `miss` lines (`"You miss."`, `"X evades."`).
- Add `playerLevel` and `enemyLevel` to `BattleConfig`; pass them from `adventure.ts` (`player.level`, `battle.enemy.level`).

## 6. Client changes — `src/adventure.ts`, `src/style.css`

- `Quest` type: add `giverNpcId`-free fields `completionText`, `objectives: {label,current,required,done}[]`,
  `state: 'locked'|'available'|'active'|'ready'|'done'`, `lockedReason`.
- `renderZone` quest card:
  - giver name as a dialogue header, quest `text` body;
  - one progress row per objective with checkmark when done;
  - state chip (`Locked` / `Available` / `Active` / `Ready to turn in` / `Completed`);
  - `locked` shows `lockedReason` and no Accept button;
  - `ready` shows `Turn in`; turn-in result shows `completionText`.
  - class reward item rendered from the server-resolved reward map.
- NPC dialogue panel: clicking a quest name toggles an inline dialogue block with the full `text` and, when ready, the
  `completionText` (no new modal framework).
- `mountBattle3D` passes `playerLevel` / `enemyLevel`.
- `style.css`: styles for `.avo-quest-objectives`, `.avo-quest-state`, `.avo-quest-dialog`, locked state.

## 7. Explicit non-goals

- No literal copy of the 241-quest database or the 20 Hz spatial tick sim.
- No professions/farming/gathering quests in this phase.
- No changes to wallet, SUMO payout plumbing, dungeon group play, or the other four zones.
- No missing-asset image creation; all icons reuse existing `public/woc` files.

## 8. Verification

1. `node --check app/backend/adventure.mjs`
2. `npm run check:ts`
3. `npm test`
4. `npm run build`
5. Server smoke test on `http://127.0.0.1:8788/`:
   - fresh wallet → choose class → overview contains all 19 Eastbrook quests with correct states;
   - `q_wolves` locked? no → accept → kill 8 wolves → `ready` → turn in → 250 XP / 75 SUMO granted, `done`;
   - `q_greyjaw` becomes `available` only after `q_wolves` is done;
   - `q_spiders` shows two objective rows and requires both;
   - `q_divine_tome` is `locked` for non-paladins with `lockedReason`;
   - boss `morthen` is gated behind `q_rite`.
6. Headless screenshot of the Eastbrook quest panel with multi-objective rows.

## 9. Approval

Approve this spec to start implementation. Reply with any of: approve / change X (content, rewards, excluded profession quests,
combat pacing).
