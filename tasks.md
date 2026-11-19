# Tasks — Port ClaudeCraft Eastbrook Vale (quests + combat rules)

Ordered, dependency-aware. Each task lists exact files and the verification gate.

## 1. Quest schema + state machine (backend)
**File:** `app/backend/adventure.mjs`

- [x] Convert `ZONES['eastbrook-vale'].quests` to the multi-objective schema from `spec.md` §4.1.
- [x] Add `questProgress: {}` to `freshPlayer`.
- [x] Replace `objectiveCount` / `questView` with `objectiveCount(entry, quest, objective, index)`, `questState(entry, quest)`,
      and the new `questView` (§4.2), including `lockedReason`.
- [x] Rewrite `acceptQuest` (§4.3) to check `available`, prerequisite, level, and class.
- [x] Rewrite `turnInQuest` to require `ready`, consume all collect objectives, grant `items` + resolved `classItems`,
      set `lastResult.message = completionText`.
- [x] Add `creditQuestObjectives(entry, mobId)` and call it from `winBattle` before loot/XP.
- [x] Gate `sexton_marrow` / `morthen` battles on `q_rite` in `startBattle`.

**Gate:** `node --check app/backend/adventure.mjs`

## 2. Eastbrook mobs, boss, items (backend)
**File:** `app/backend/adventure.mjs`

- [x] Add `mudfin_murloc`, `tunnel_rat`, `restless_bones`, `greyjaw`, `gorrak`, `mogger`, `sexton_marrow` to the zone mob list.
- [x] Replace zone boss with `morthen` (§3.1) and add the `requiresQuest` gate.
- [x] Add quest items + reward gear to `ITEMS` with existing `/woc/items/*.webp` icons.
- [x] Seed quest-item drops in the mob loot tables (§3.1).

**Gate:** overview JSON for a test wallet lists the new mobs/items; no `undefined` icon paths.

## 3. Combat rules module (client)
**Files:** `src/combat-rules.ts` (new), `src/battle3d.ts`

- [x] Create `src/combat-rules.ts` with `aboveLevelMissPct`, `meleeMissChance`, `swingMissChance`, `spellHitChance`,
      `armorReduction`, `mobArmorReduction`, `critMultiplier` (§5).
- [x] Add `playerLevel` / `enemyLevel` to `BattleConfig` in `battle3d.ts` and use them in the damage roll.
- [x] Replace `playerDamage()` and `enemyDamage()` with the rule-based rolls; add miss log lines.
- [x] Route `resolveHeroStrike` and `useAbility` through the new rolls (physical armor DR, spell ×1.5 crit).
- [x] Mirror the same formulas in the legacy turn-based `act` / `basicAttack` / `enemyTurn` in `adventure.mjs`.

**Gate:** `npm run check:ts`

## 4. Quest UI + dialogue
**Files:** `src/adventure.ts`, `src/style.css`

- [x] Update the `Quest` type for objectives/state/lockedReason/completionText.
- [x] Render giver dialogue, per-objective progress rows, state chips, locked reason, and class reward item.
- [x] Add the inline NPC dialogue toggle and completion text on turn-in.
- [x] Pass `playerLevel` / `enemyLevel` into `startBattle3D`.
- [x] Add styles for the new quest elements.

**Gate:** `npm run check:ts`

## 5. Verification
- [x] `node --check app/backend/adventure.mjs`
- [x] `npm run check:ts`
- [x] `npm test`
- [x] `npm run build`
- [x] Start/refresh the local server (`:8788`) and run the API smoke test in `spec.md` §8.5.
- [x] Headless screenshot of the Eastbrook quest panel with multi-objective rows.

**Gate:** all commands green; smoke test proves prereq gating, multi-objective, collect consumption, class lock, boss gate.

## 6. Report
- [x] Summarize ported quests, combat formulas, exclusions (profession quests), and verification output.

## Follow-on (not this phase)
- [x] Re-run the same pipeline for Mirefen Marsh, Thornpeak Heights, Drakelands, Willowfen.
- [x] Add assert coverage for quest state transitions and combat rules.
