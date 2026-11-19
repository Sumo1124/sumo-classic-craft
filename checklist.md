# Checklist — Eastbrook Vale port verification

## Backend
- [x] `node --check app/backend/adventure.mjs`
- [x] 19 Eastbrook Vale quests present with multi-objective schema
- [x] Quest states: locked / available / active / ready / done
- [x] Kill objectives credit only while the quest is active
- [x] Collect objectives consume items on turn-in
- [x] Prerequisite quests gate acceptance (`q_greyjaw`, `q_bandits`, `q_whispers`, `q_hollow`, ...)
- [x] Level gates (`q_spiders` L2, `q_murlocs` L3, `q_supplies` L3, `q_mine` L4, `q_bones` L5, `q_divine_tome`/`q_mogger` L6)
- [x] Paladin-only `q_divine_tome` reports "Only Paladin may take this quest"
- [x] Boss `morthen` + `sexton_marrow` gated behind `q_rite`
- [x] Class reward items resolve per role (warrior/mage/rogue groups)
- [x] Quest items and reward gear use existing `/woc` icons
- [x] No missing art paths for the new mobs

## Combat rules
- [x] `src/combat-rules.ts` created with miss, spell hit, armor DR, mob armor cap, crit multipliers
- [x] `battle3d.ts` uses the rules for hero swings, abilities, and enemy swings
- [x] Turn-based `act` uses the same miss / armor / crit rules
- [x] Real-time pacing unchanged (0.5 s player swing, 0.52 s / 0.85 s mob timings)

## Client
- [x] Quest cards show NPC giver, dialogue text, objective rows, state chips, locked reason
- [x] Inline dialogue (`<details>`) shows the completion text
- [x] Locked mobs/boss render disabled with a lock tooltip
- [x] `startBattle3D` receives `playerLevel` / `enemyLevel`
- [x] New quest styles added to `style.css`

## Commands
- [x] `npm run check:ts`
- [x] `npm test` (68 passing)
- [x] `npm run build`

## API smoke test
- [x] 19 quests returned for Eastbrook Vale
- [x] `q_wolves` available → active → 8/8 ready → done (+75 SUMO, sumoEarned 123)
- [x] `q_greyjaw` becomes available after `q_wolves`
- [x] `q_spiders` returns two objectives
- [x] Boss battle rejected with `Requires The Binding Rite.`
- [x] `q_divine_tome` locked for non-paladins

## Visual verification
- [x] Headless Chrome screenshot of the Eastbrook quest panel with multi-objective rows, locked chips, and Morthen
