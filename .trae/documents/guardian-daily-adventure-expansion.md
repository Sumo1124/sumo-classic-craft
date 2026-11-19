# Guardian Daily Adventure Expansion

## Context

Sumo Classic Craft currently has six server-authoritative Guardian Match stages, persistent local SUMO, MetaMask-signed clears, and optional Sepolia vouchers. The user wants a structure inspired by MeadowFarm: selectable characters, staged daily challenges, coin rewards, sound, and richer graphics. The chosen direction is to keep Guardian Match, add guardian adventures and a three-step daily quest chain, and remove timers from the entire game.

The implementation will remain local-first. It will not change contracts, credentials, IPFS metadata, deployment configuration, or the user's `.env`, and it will not deploy anything publicly.

## Product scope

- Three playable guardians using the existing original artwork; NFT ownership is not required.
- Six existing chapter stages with unchanged IDs, pair counts, and 825 total first-clear SUMO rewards.
- No countdowns, time-limit losses, session expiration by age, elapsed-time HUD, or time-based scores anywhere.
- A deterministic three-step daily adventure based on the server's UTC date, with sequential objectives and no completion deadline.
- Daily rewards are local-only: 5 + 10 + 15 SUMO for the steps and 20 SUMO for completing the chain, for exactly 50 SUMO per wallet per UTC day.
- Existing chapter rewards and future Sepolia voucher eligibility remain unchanged.
- Synthesized Web Audio effects, a persistent mute control, a chapter journey map, guardian portraits, daily progress, polished card animations, responsive layouts, and reduced-motion support.

## Implementation

### 1. Remove timers and generalize the encounter engine

Modify `app/backend/game.mjs` and `src/game.ts`:

- Remove `timeLimitSec`, deadline checks, the one-hour maximum session/completion age, client intervals, countdown state, timeout losses, and time displays.
- Rename Goldcrest Harbor Rush to an untimed adventure name while preserving stage ID 5.
- Retain server-internal `startedAt` and `solvedAt` only for the existing minimum plausible-clear check. Keep a minimum of roughly 500 ms per required pair, reject negative/non-finite durations, and impose no maximum duration.
- Store best scores by moves only. Existing `durationMs` values may remain in old saves but will be ignored for comparisons and display.
- Leave mismatched cards visible until the next selection instead of using a client hide timer.
- Extract shared internal session/deck/flip helpers so chapter and daily encounters use the same server-owned card logic rather than two game engines.

### 2. Add three server-authoritative guardians

Define public guardian metadata in `app/backend/game.mjs`, referencing existing collection item IDs and images:

| Guardian | Passive | Server behavior |
| --- | --- | --- |
| Carrick Vale | Guiding Light | At deal time, reveal one pair's two indexes and item index as an opening hint. |
| Whispering Marsh | Gentle Echo | The first mismatch does not increment the scored move count; record that the passive was consumed. |
| Emberpeak | Ember Insight | After the first mismatch, reveal the location of one flipped card's mate; later mismatches receive no hint. |

- Accept and validate `guardianId` at encounter start, defaulting legacy callers to Carrick Vale.
- Store guardian and passive usage on each session.
- Return only intentional hint data, never the full deck.
- Preserve old sessions without guardian data by giving them no passive.
- Guardian choice must never alter rewards, voucher amounts, or eligibility.
- Do not add mana, upgrades, inventories, skill buttons, or a generic ability framework.

### 3. Add deterministic daily adventures

Create `app/backend/daily.mjs`:

- Derive a `YYYY-MM-DD` UTC date and hash a versioned date key to select a daily plan shared by all wallets.
- Define a small template pool with three encounter types:
  1. **Clear:** clear a three- or four-pair board.
  2. **Seek:** find two featured guardian pairs within a five-pair board.
  3. **Restore:** clear a six-pair board.
- Rotate names, artwork, featured guardians, and permitted board sizes deterministically. Continue using secure random shuffling for each actual deck.
- Guarantee featured pairs during deck creation and evaluate objective completion only from server-owned matched indexes.
- Add a separate daily signature message binding wallet, UTC date, step, plan ID, and session ID.
- Snapshot the plan and date in each session. An encounter begun before midnight can finish afterward and credits its original date; it never expires at midnight.

### 4. Persist daily rewards without disturbing existing saves

Modify `app/backend/store.mjs`:

- Additively load a `dailyEarned` ledger, defaulting missing data to an empty object and rejecting malformed existing ledgers rather than reopening rewards.
- Key entries by lowercase wallet and UTC date, with step-position rewards and a completion bonus.
- Award step three and the completion bonus in one synchronous mutation and atomic JSON save.
- Make retries and concurrent submissions idempotent; a wallet can receive at most 50 daily SUMO per date.
- Include both chapter `localEarned` and `dailyEarned` in `progress.localBalance`.
- Keep daily entries out of chapter `earned`, voucher, and nonce namespaces.
- Preserve existing sessions, chapter rewards, vouchers, and best scores. Do not manually rewrite `app/data/game.local.json`.
- Stop age-pruning unresolved sessions; retain existing global and per-wallet caps, and prune only completed history by age.

### 5. Extend APIs while preserving chapter behavior

Modify `app/backend/server.mjs` and the methods in `app/backend/game.mjs`:

- `GET /api/game/stages`: add guardian metadata and remove time-limit fields.
- `POST /api/game/start`: accept `guardianId` and return guardian/opening-hint data without client clock fields.
- Existing chapter flip/complete routes retain their signature text, fixed local rewards, original-voucher retries, and Sepolia behavior.
- Add `GET /api/game/daily?address=...` for plan, step statuses, claimed total, completion, and local balance.
- Add daily `start`, `flip`, and `complete` POST routes. The server determines the current plan and unlocked step; clients cannot select a different date or skip steps.
- Daily completion returns local step/completion rewards and updated progress only. It never calls the claim signer, allocates a nonce, or returns a voucher.

### 6. Build the journey, character, and daily UI

Modify `src/main.ts`, `src/game.ts`, and `src/style.css`:

- Keep the MetaMask gate, Sepolia clients, collection view, and global balance synchronization intact.
- Add a guardian selector, a six-node journey map using `public/map_art/world_overview.webp`, chapter rewards/best moves/clear badges, and a recommended next chapter without introducing new chapter locks.
- Add a daily preview and roadmap showing claimed/current/locked steps and objective progress.
- Share one board renderer between chapter and daily encounters, including guardian portrait/passive, move count, hint states, and featured-pair progress.
- Preserve the chapter Sepolia claim flow; daily results show local rewards only.
- Reuse the eight existing guardian JPGs for portraits, chapters, cards, and results. No placeholder or stock imagery.
- Add polished CSS 3D flips, match/hint/reward effects, accessible focus states, mobile map layouts, and `prefers-reduced-motion` behavior.

### 7. Add sound safely

Create `src/audio.ts`, following the lifecycle pattern—not the branding or assets—of the reference `public/farm-audio.mjs`:

- Lazily create/resume one `AudioContext` after pointer or keyboard interaction.
- Generate short flip, match, mismatch, guardian-hint, clear, and reward effects through a master gain node.
- Create the controller once in `main.ts`, pass it to the game, and add a persistent mute button in the app header.
- Persist mute under a versioned localStorage key, tolerate unavailable storage/audio, silence hidden tabs, disconnect completed nodes, and clean up listeners/context.
- Play result sounds only after authoritative server responses. Do not add background music or external audio downloads in this iteration.

### 8. Add and update tests

Modify `app/test/game.test.mjs` and `app/test/store.test.mjs`; create `app/test/daily.test.mjs`:

- Verify all six chapters are untimed, total chapter rewards remain 825, old timed sessions can finish, long sessions remain valid, and implausibly fast/negative clears fail.
- Verify each guardian passive triggers correctly at most once and never changes rewards.
- Retain coverage for hidden decks, forged clears, wallet signatures, local-once rewards, concurrent clears, original vouchers, and practice-then-Sepolia eligibility.
- Verify daily determinism, featured decks, sequential steps, signature binding, rollover snapshots, no voucher/nonce use, and exactly 50 SUMO once despite retries/concurrency.
- Verify legacy save migration preserves chapter balances, rewards, vouchers, and scores while adding daily support.

## Verification

1. Run `npm run check:ts`, `npm test`, and `npm run build`.
2. Start locally with `npm start` and confirm loopback-only serving plus healthy JSON APIs.
3. Use the browser with MetaMask on Sepolia to select each guardian, play all chapter difficulties without clocks, and confirm first-clear/replay reward behavior.
4. Complete all three daily steps; verify 5/10/15 + 20 SUMO, sequential unlocking, persistence after reload, and absence of a Sepolia claim button for daily rewards.
5. Switch wallets and confirm chapter and daily progress are isolated.
6. Verify sound begins only after interaction, mute survives reload, hidden tabs are silent, and audio failure cannot block gameplay.
7. Check desktop/mobile layouts, keyboard card play, reduced motion, account changes, and unmount cleanup.
