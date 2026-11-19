import { createWalletClient, custom, parseAbi, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import type { GameAudio } from './audio';

type Stage = { id: number; name: string; pairs: number; reward: number };
type Guardian = {
  id: string;
  name: string;
  title: string;
  skillName: string;
  skillDescription: string;
  itemIndex: number;
};
type Score = { moves: number };
type Progress = { earned: number[]; best: Record<string, Score>; localBalance: number };
type Item = { id: number; name: string; image: string };
type Voucher = { to: Address; amount: string; nonce: string; signature: `0x${string}` };
type Hint = { kind: 'pair' | 'mate'; indexes: number[]; itemIndex: number; sourceIndex?: number };
type ObjectiveKind = 'clear' | 'seek' | 'restore';
type DailyStep = {
  position: number;
  kind: ObjectiveKind;
  name: string;
  description: string;
  pairs: number;
  requiredPairs: number;
  featured: number[];
  itemIndex: number;
  reward: number;
  status?: 'claimed' | 'current' | 'locked';
};
type DailyPlan = {
  date: string;
  planId: string;
  name: string;
  totalReward: number;
  completionReward: number;
  claimedTotal: number;
  completed: boolean;
  localBalance: number;
  steps: DailyStep[];
};
type Session = {
  sessionId: string;
  mode: 'chapter' | 'daily';
  cardCount: number;
  guardian: Guardian;
  hint: Hint | null;
  stage?: Stage;
  daily?: { date: string; planId: string; name: string; step: number };
  objective?: DailyStep;
};
type ObjectiveProgress = { kind: ObjectiveKind; current: number; required: number; featured: number[] };
type FlipResult = {
  index: number;
  itemIndex: number;
  moves: number;
  matched: boolean;
  matchedIndexes: number[];
  objectiveProgress: ObjectiveProgress;
  hint: Hint | null;
  skillTriggered: boolean;
  solved: boolean;
};
type Completion = {
  mode?: 'daily';
  step?: number;
  moves: number;
  message: string;
  voucher?: Voucher | null;
  localReward: number;
  localBalance: number;
  completionReward?: number;
  daily?: DailyPlan;
};
type Overview = { stages: Stage[]; guardians: Guardian[]; progress: Progress; daily: DailyPlan };

type MountArgs = {
  container: HTMLElement;
  getAccount: () => Address | null;
  requestConnect: () => Promise<void>;
  items: Item[];
  explorer: string;
  sumoCoin: Address | null;
  onBalance: (amount: number) => void;
  audio: GameAudio;
};

const coinAbi = parseAbi([
  'function claim(address to, uint256 amount, uint256 nonce, bytes signature)',
]);
const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const coins = (amount: number) => amount.toLocaleString('en-US');

function metaMaskProvider(): unknown {
  const injected = (window as { ethereum?: { isMetaMask?: boolean; providers?: unknown[] } }).ethereum;
  const provider = injected?.providers?.find((entry) => (entry as { isMetaMask?: boolean }).isMetaMask);
  return provider ?? (injected?.isMetaMask ? injected : null);
}

async function request<T>(url: string, input?: unknown): Promise<T> {
  const response = await fetch(url, input === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'The game request failed.');
  return body as T;
}

/** Untimed Guardian Match with shared chapter and daily encounters. */
export function mountGame({ container, getAccount, requestConnect, items, explorer, sumoCoin, onBalance, audio }: MountArgs) {
  let active = true;
  let session: Session | null = null;
  let selectedGuardianId = 'carrick-vale';
  let flipped: number[] = [];
  let matched = new Set<number>();
  let hinted = new Set<number>();
  let moves = 0;
  let lock = false;
  let passiveUsed = false;
  let objective: ObjectiveProgress = { kind: 'clear', current: 0, required: 0, featured: [] };

  function itemAt(index: number | undefined): Item | undefined {
    return index === undefined ? undefined : items[index];
  }

  function setMessage(message: string) {
    const element = container.querySelector('#game-msg');
    if (element) element.textContent = message;
  }

  function renderError(message: string, retry: () => void) {
    if (!active) return;
    container.innerHTML = `
      <div class="win-panel" role="alert">
        <p class="eyebrow">THE PATH IS PAUSED</p>
        <p class="warn" id="game-error"></p>
        <div class="game-actions">
          <button id="game-error-retry" class="primary">Try again</button>
          <button id="game-error-journey">Return to journey</button>
        </div>
      </div>`;
    container.querySelector('#game-error')!.textContent = message;
    container.querySelector('#game-error-retry')!.addEventListener('click', retry);
    container.querySelector('#game-error-journey')!.addEventListener('click', () => void showOverview());
  }

  function guardianButton(guardian: Guardian) {
    const artwork = itemAt(guardian.itemIndex);
    const selected = guardian.id === selectedGuardianId;
    return `
      <button class="guardian-choice ${selected ? 'selected' : ''}" data-guardian="${guardian.id}" aria-pressed="${selected}">
        <span class="guardian-portrait">${artwork ? `<img src="${artwork.image}" alt="${guardian.name}" />` : ''}</span>
        <span class="guardian-copy"><small>${guardian.title}</small><strong>${guardian.name}</strong><b>${guardian.skillName}</b><span>${guardian.skillDescription}</span></span>
        <i aria-hidden="true"></i>
      </button>`;
  }

  function renderOverview({ stages, guardians, progress, daily }: Overview) {
    if (!active) return;
    if (!guardians.some((guardian) => guardian.id === selectedGuardianId)) selectedGuardianId = guardians[0]?.id ?? '';
    onBalance(progress.localBalance);
    const nextStage = stages.find((stage) => !progress.earned.includes(stage.id)) ?? stages[0];
    container.innerHTML = `
      <div class="game-head">
        <div><p class="eyebrow">WORLD OF CARRICKCRAFT</p><h2>Guardian adventures</h2>
        <p>Choose a companion, follow the realm road, and complete a new three-step trail each UTC day. Every encounter is untimed.</p></div>
        <div class="game-balance"><span>GAME WALLET</span><strong>${coins(progress.localBalance)} SUMO</strong><small>Chapters + daily trails</small></div>
      </div>

      <section class="guardian-select" aria-labelledby="guardian-heading">
        <div class="adventure-section-head"><div><p class="eyebrow">01 · CHOOSE YOUR COMPANION</p><h3 id="guardian-heading">Three guardians. Three ways to play.</h3></div><span>Passives never change coin rewards</span></div>
        <div class="guardian-grid">${guardians.map(guardianButton).join('')}</div>
      </section>

      <section class="journey-section" aria-labelledby="journey-heading">
        <div class="adventure-section-head"><div><p class="eyebrow">02 · THE REALM ROAD</p><h3 id="journey-heading">Six handcrafted chapters</h3></div><span>825 SUMO in first-clear rewards · no chapter locks</span></div>
        <div class="journey-map">
          ${stages.map((stage) => {
            const best = progress.best[String(stage.id)];
            const earned = progress.earned.includes(stage.id);
            const recommended = stage.id === nextStage?.id;
            const artwork = itemAt(stage.id - 1);
            return `
              <article class="stage-node ${earned ? 'cleared' : ''} ${recommended ? 'recommended' : ''}">
                <div class="stage-node-art">${artwork ? `<img src="${artwork.image}" alt="" loading="lazy" />` : ''}<span>0${stage.id}</span>${earned ? '<b>RESTORED</b>' : ''}</div>
                <div class="stage-node-body">
                  ${recommended ? '<small class="recommended-label">RECOMMENDED NEXT</small>' : ''}
                  <h4>${stage.name}</h4>
                  <p>${stage.pairs} pairs · Untimed</p>
                  <strong class="reward">+${stage.reward} SUMO</strong>
                  <small>${best ? `Best clear: ${best.moves} moves` : earned ? 'Cleared · replay to improve your moves' : 'Awaiting your first clear'}</small>
                  <button class="${recommended ? 'primary' : ''}" data-stage="${stage.id}">${best || earned ? 'Replay chapter' : 'Enter chapter'}</button>
                </div>
              </article>`;
          }).join('')}
        </div>
      </section>

      <section class="daily-section" aria-labelledby="daily-heading">
        <div class="daily-heading-art">${itemAt(daily.steps[0]?.itemIndex) ? `<img src="${itemAt(daily.steps[0]?.itemIndex)!.image}" alt="" loading="lazy" />` : ''}</div>
        <div class="daily-content">
          <div class="adventure-section-head"><div><p class="eyebrow">03 · DAILY GUARDIAN TRAIL</p><h3 id="daily-heading">${daily.name}</h3><p>${daily.date} · Three untimed encounters shared by every realm traveler</p></div><div class="daily-total"><strong>${daily.claimedTotal} / ${daily.totalReward}</strong><span>LOCAL SUMO TODAY</span></div></div>
          <div class="daily-roadmap">
            ${daily.steps.map((step) => {
              const artwork = itemAt(step.itemIndex);
              const status = step.status ?? 'locked';
              return `
                <article class="daily-step ${status}">
                  <div class="daily-step-top"><span>STEP 0${step.position}</span><b>${status === 'claimed' ? 'CLAIMED' : status === 'current' ? 'READY' : 'LOCKED'}</b></div>
                  <div class="daily-step-title">${artwork ? `<img src="${artwork.image}" alt="" />` : ''}<div><h4>${step.name}</h4><small>${step.kind.toUpperCase()} · ${step.pairs} PAIRS</small></div></div>
                  <p>${step.description}</p>
                  <div class="daily-step-bottom"><strong>+${step.reward} SUMO</strong><button data-daily="${step.position}" ${status === 'locked' ? 'disabled' : ''}>${status === 'claimed' ? 'Replay' : status === 'current' ? 'Begin step' : 'Complete prior step'}</button></div>
                </article>`;
            }).join('')}
          </div>
          <div class="daily-bonus ${daily.completed ? 'claimed' : ''}"><span>TRAIL COMPLETION BONUS</span><strong>+${daily.completionReward} SUMO</strong><small>${daily.completed ? 'Trail restored. You can replay any step without collecting twice.' : 'Finish all three steps to collect the full 50 SUMO. Local rewards only; no Sepolia voucher.'}</small></div>
        </div>
      </section>`;

    container.querySelectorAll<HTMLButtonElement>('button[data-guardian]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedGuardianId = button.dataset.guardian!;
        container.querySelectorAll<HTMLButtonElement>('button[data-guardian]').forEach((choice) => {
          const selected = choice === button;
          choice.classList.toggle('selected', selected);
          choice.setAttribute('aria-pressed', String(selected));
        });
        audio.play('flip');
      });
    });
    container.querySelectorAll<HTMLButtonElement>('button[data-stage]').forEach((button) => {
      button.addEventListener('click', () => void startEncounter('chapter', Number(button.dataset.stage)));
    });
    container.querySelectorAll<HTMLButtonElement>('button[data-daily]').forEach((button) => {
      button.addEventListener('click', () => void startEncounter('daily', Number(button.dataset.daily)));
    });
  }

  async function showOverview() {
    session = null;
    lock = false;
    container.innerHTML = '<div class="adventure-loading" role="status"><span></span><p>Opening the realm map…</p></div>';
    try {
      const account = getAccount();
      if (!account) {
        await requestConnect();
        if (!active || !getAccount()) return;
      }
      const address = getAccount()!;
      const query = `?address=${encodeURIComponent(address)}`;
      const [chapterResponse, daily] = await Promise.all([
        request<{ stages: Stage[]; guardians: Guardian[]; progress: Progress }>(`/api/game/stages${query}`),
        request<DailyPlan>(`/api/game/daily${query}`),
      ]);
      if (!active) return;
      renderOverview({ ...chapterResponse, daily });
    } catch (error) {
      renderError(errorText(error, 'Could not open the adventure map.'), () => void showOverview());
    }
  }

  async function startEncounter(mode: 'chapter' | 'daily', id: number) {
    try {
      if (!getAccount()) {
        await requestConnect();
        if (!active || !getAccount()) return;
      }
      session = null;
      container.innerHTML = '<div class="adventure-loading" role="status"><span></span><p>Your guardian is preparing the cards…</p></div>';
      const next = mode === 'chapter'
        ? await request<Session>('/api/game/start', { address: getAccount(), stage: id, guardianId: selectedGuardianId })
        : await request<Session>('/api/game/daily/start', { address: getAccount(), step: id, guardianId: selectedGuardianId });
      if (!active) return;
      session = next;
      flipped = [];
      matched = new Set();
      hinted = new Set();
      moves = 0;
      lock = false;
      passiveUsed = next.guardian.id === 'carrick-vale';
      objective = {
        kind: next.objective?.kind ?? 'clear',
        current: 0,
        required: next.objective?.requiredPairs ?? next.stage?.pairs ?? 0,
        featured: [...(next.objective?.featured ?? [])],
      };
      renderBoard();
      if (next.hint) {
        applyHint(next.hint);
        audio.play('hint');
        setMessage(`${next.guardian.skillName}: this matching pair is revealed for your opening move.`);
      }
    } catch (error) {
      renderError(errorText(error, 'Could not prepare this encounter.'), () => void startEncounter(mode, id));
    }
  }

  function encounterTitle() {
    if (!session) return '';
    return session.mode === 'chapter'
      ? `${session.stage!.id}. ${session.stage!.name}`
      : `Daily ${session.daily!.step}. ${session.objective!.name}`;
  }

  function renderBoard() {
    if (!session) return;
    const current = session;
    const reward = current.mode === 'chapter' ? current.stage!.reward : current.objective!.reward;
    const artwork = itemAt(current.guardian.itemIndex);
    const columns = current.cardCount <= 6 ? 3 : 4;
    container.innerHTML = `
      <div class="encounter-topline"><button id="game-journey" class="text-button">← Realm road</button><span>UNTIMED ENCOUNTER</span></div>
      <div class="encounter-layout">
        <aside class="encounter-companion">
          <div class="companion-art">${artwork ? `<img src="${artwork.image}" alt="${current.guardian.name}" />` : ''}<span>${current.guardian.title}</span></div>
          <p class="eyebrow">YOUR COMPANION</p><h3>${current.guardian.name}</h3>
          <strong>${current.guardian.skillName}</strong><p>${current.guardian.skillDescription}</p>
          <small id="passive-state" class="passive-state"></small>
        </aside>
        <div class="encounter-main">
          <div class="game-hud">
            <div><small>${current.mode === 'chapter' ? 'REALM CHAPTER' : current.daily!.name}</small><strong>${encounterTitle()}</strong></div>
            <span>Moves <b id="hud-moves">0</b></span>
            <span class="reward">+${reward} SUMO</span>
          </div>
          <div class="objective-panel">
            <div><span id="objective-label">${current.objective?.description ?? 'Match every guardian pair to restore this chapter.'}</span><strong id="hud-progress">0 / ${objective.required}</strong></div>
            <div class="objective-meter" aria-hidden="true"><i style="width: 0%"></i></div>
            ${objective.kind === 'seek' ? `<div class="featured-guardians"><span>FEATURED PAIRS</span>${objective.featured.map((index) => { const item = itemAt(index); return item ? `<div><img src="${item.image}" alt="${item.name}" /><small>${item.name}</small></div>` : ''; }).join('')}</div>` : ''}
          </div>
          <div class="board" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));" aria-label="Guardian memory cards">
            ${Array.from({ length: current.cardCount }, (_, index) => `
              <button class="gcard" data-index="${index}" aria-label="Card ${index + 1}, face down">
                <span class="gcard-inner">
                  <span class="gcard-back" aria-hidden="true"><i>S</i><small>CARRICKCRAFT</small></span>
                  <span class="gcard-front"><img class="gcard-face" alt="" draggable="false" /><span class="gcard-name"></span></span>
                </span>
              </button>`).join('')}
          </div>
          <div class="game-actions">
            <button id="game-restart">Restart encounter</button>
            <button id="game-submit" class="primary" hidden>Retry clear submission</button>
            <span id="game-msg" class="result" role="status" aria-live="polite">Choose any card. Take all the time you need.</span>
          </div>
        </div>
      </div>`;
    container.querySelectorAll<HTMLButtonElement>('.gcard').forEach((card) => {
      card.addEventListener('click', () => void flip(Number(card.dataset.index)));
    });
    container.querySelector('#game-restart')!.addEventListener('click', () => {
      const id = current.mode === 'chapter' ? current.stage!.id : current.daily!.step;
      void startEncounter(current.mode, id);
    });
    container.querySelector('#game-journey')!.addEventListener('click', () => void showOverview());
    container.querySelector('#game-submit')!.addEventListener('click', () => void submitClear());
    paintCards();
  }

  function revealCard(index: number, itemIndex: number) {
    const card = container.querySelector<HTMLButtonElement>(`.gcard[data-index="${index}"]`);
    if (!card) return;
    const item = itemAt(itemIndex);
    card.dataset.item = String(itemIndex);
    const image = card.querySelector<HTMLImageElement>('.gcard-face')!;
    image.src = item?.image ?? '';
    image.alt = item?.name ?? 'Guardian artwork';
    card.querySelector('.gcard-name')!.textContent = item?.name ?? 'Guardian';
  }

  function applyHint(hint: Hint) {
    for (const index of hint.indexes) {
      if (index < 0 || index >= (session?.cardCount ?? 0)) continue;
      revealCard(index, hint.itemIndex);
      hinted.add(index);
    }
    paintCards();
  }

  function paintCards() {
    container.querySelectorAll<HTMLButtonElement>('.gcard').forEach((card) => {
      const index = Number(card.dataset.index);
      const isFlipped = flipped.includes(index);
      const isMatched = matched.has(index);
      const isHinted = hinted.has(index) && !isFlipped && !isMatched;
      const item = itemAt(Number(card.dataset.item));
      card.classList.toggle('flipped', isFlipped);
      card.classList.toggle('matched', isMatched);
      card.classList.toggle('hinted', isHinted);
      card.disabled = isMatched;
      card.setAttribute('aria-label', isMatched
        ? `Card ${index + 1}, ${item?.name ?? 'guardian'}, matched`
        : isFlipped || isHinted
          ? `Card ${index + 1}, ${item?.name ?? 'guardian'}, revealed${isHinted ? ' by your companion' : ''}`
          : `Card ${index + 1}, face down`);
    });
    const hudMoves = container.querySelector('#hud-moves');
    if (hudMoves) hudMoves.textContent = String(moves);
    const hudProgress = container.querySelector('#hud-progress');
    if (hudProgress) hudProgress.textContent = `${objective.current} / ${objective.required}`;
    const meter = container.querySelector<HTMLElement>('.objective-meter i');
    if (meter) meter.style.width = `${Math.min(100, objective.required ? objective.current / objective.required * 100 : 0)}%`;
    const passive = container.querySelector('#passive-state');
    if (passive && session) {
      passive.textContent = session.guardian.id === 'carrick-vale'
        ? 'Guiding Light · opening pair revealed'
        : `${session.guardian.skillName} · ${passiveUsed ? 'used' : 'ready'}`;
      passive.classList.toggle('used', passiveUsed);
    }
  }

  async function flip(index: number) {
    if (!session || lock || matched.has(index) || (flipped.length < 2 && flipped.includes(index))) return;
    const current = session;
    lock = true;
    flipped = flipped.length === 2 ? [] : flipped;
    hinted.clear();
    paintCards();
    try {
      const result = current.mode === 'chapter'
        ? await request<FlipResult>('/api/game/flip', {
            address: getAccount(), stage: current.stage!.id, sessionId: current.sessionId, index,
          })
        : await request<FlipResult>('/api/game/daily/flip', {
            address: getAccount(), sessionId: current.sessionId, index,
          });
      if (!active || session !== current) return;
      revealCard(index, result.itemIndex);
      flipped.push(index);
      moves = result.moves;
      matched = new Set(result.matchedIndexes);
      objective = result.objectiveProgress;
      if (result.matched) flipped = [];
      if (result.skillTriggered) passiveUsed = true;
      paintCards();

      if (result.hint) {
        applyHint(result.hint);
        audio.play('hint');
        setMessage(`${current.guardian.skillName}: your companion revealed a matching mate.`);
      } else {
        audio.play(result.matched ? 'match' : flipped.length === 2 ? 'mismatch' : 'flip');
        if (result.matched) {
          setMessage(objective.kind === 'seek' && !result.solved
            ? `Featured pair found. ${objective.required - objective.current} more to restore the trail.`
            : 'A guardian pair is restored.');
        } else if (flipped.length === 2) {
          setMessage(result.skillTriggered && current.guardian.id === 'whispering-marsh'
            ? `${current.guardian.skillName}: this mismatch did not count as a move.`
            : 'Not a pair. These cards stay visible until your next selection.');
        }
      }

      if (result.solved) {
        await submitClear();
      } else {
        lock = false;
      }
    } catch (error) {
      if (!active || session !== current) return;
      lock = true;
      setMessage(`${errorText(error, 'The card could not be revealed.')} Restart this encounter to continue.`);
    }
  }

  async function submitClear() {
    if (!session) return;
    const completedSession = session;
    lock = true;
    const submit = container.querySelector<HTMLButtonElement>('#game-submit');
    if (submit) submit.hidden = true;
    try {
      const account = getAccount();
      const ethereum = metaMaskProvider();
      if (!account || !ethereum) throw new Error('Connect MetaMask to submit this clear.');
      setMessage('Encounter complete! Sign the result in MetaMask…');
      const wallet = createWalletClient({ chain: sepolia, transport: custom(ethereum as never) });
      const message = completedSession.mode === 'chapter'
        ? [
            'Sumo Classic Craft: World of CarrickCraft — Guardian Match stage clear',
            `Address: ${account.toLowerCase()}`,
            `Stage: ${completedSession.stage!.id}`,
            `Session: ${completedSession.sessionId}`,
          ].join('\n')
        : [
            'Sumo Classic Craft: World of CarrickCraft — Guardian Match daily clear',
            `Address: ${account.toLowerCase()}`,
            `Date: ${completedSession.daily!.date}`,
            `Step: ${completedSession.daily!.step}`,
            `Plan: ${completedSession.daily!.planId}`,
            `Session: ${completedSession.sessionId}`,
          ].join('\n');
      const signature = await wallet.signMessage({ account, message });
      const result = completedSession.mode === 'chapter'
        ? await request<Completion>('/api/game/complete', {
            address: account, stage: completedSession.stage!.id, sessionId: completedSession.sessionId, signature,
          })
        : await request<Completion>('/api/game/daily/complete', {
            address: account, sessionId: completedSession.sessionId, signature,
          });
      if (!active || session !== completedSession) return;
      onBalance(result.localBalance);
      audio.play('clear');
      if (result.localReward > 0) audio.play('reward');
      showCompletion(completedSession, result);
    } catch (error) {
      if (!active || session !== completedSession) return;
      setMessage(errorText(error, 'The clear could not be submitted. Try again.'));
      if (submit) submit.hidden = false;
    }
  }

  function showCompletion(completedSession: Session, result: Completion) {
    container.querySelector('.win-panel')?.remove();
    const id = completedSession.mode === 'chapter' ? completedSession.stage!.id : completedSession.daily!.step;
    const artwork = itemAt(completedSession.mode === 'chapter'
      ? completedSession.stage!.id - 1
      : completedSession.objective!.itemIndex);
    const panel = document.createElement('div');
    panel.className = 'win-panel';
    panel.tabIndex = -1;
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `
      <div class="win-art">${artwork ? `<img src="${artwork.image}" alt="" />` : ''}</div>
      <div class="win-copy"><p class="eyebrow">${completedSession.mode === 'chapter' ? 'REALM RESTORED' : 'DAILY TRAIL ADVANCED'}</p>
      <h3>${completedSession.mode === 'chapter' ? completedSession.stage!.name : completedSession.objective!.name} · ${result.moves} moves</h3>
      <p>${result.message}</p>
      ${result.localReward > 0 ? `<strong class="win-reward">+${result.localReward} LOCAL SUMO</strong>` : '<small>No duplicate coin reward on this replay.</small>'}
      <div class="game-actions">
        ${result.voucher ? '<button id="claim-reward" class="primary">Claim on Sepolia</button>' : ''}
        ${completedSession.mode === 'daily' && id < 3 ? '<button id="win-next" class="primary">Continue daily trail</button>' : ''}
        <button id="win-replay">Replay</button>
        <button id="win-journey">Realm road</button>
      </div>
      <p id="claim-msg" class="result" role="status" aria-live="polite"></p></div>`;
    container.appendChild(panel);
    panel.focus();
    panel.querySelector('#win-replay')!.addEventListener('click', () => void startEncounter(completedSession.mode, id));
    panel.querySelector('#win-journey')!.addEventListener('click', () => void showOverview());
    panel.querySelector('#win-next')?.addEventListener('click', () => void showOverview());
    if (result.voucher) {
      panel.querySelector('#claim-reward')!.addEventListener('click', () => void claimReward(result.voucher as Voucher));
    }
  }

  async function claimReward(voucher: Voucher) {
    const msg = container.querySelector('#claim-msg')!;
    const button = container.querySelector<HTMLButtonElement>('#claim-reward')!;
    const ethereum = metaMaskProvider();
    const account = getAccount();
    if (!ethereum || !account || !sumoCoin) {
      msg.textContent = 'Connect a wallet and configure SumoCoin to claim.';
      return;
    }
    try {
      button.disabled = true;
      msg.textContent = 'Confirm the claim in your wallet…';
      const wallet = createWalletClient({ chain: sepolia, transport: custom(ethereum as never) });
      const hash = await wallet.writeContract({
        address: sumoCoin,
        abi: coinAbi,
        functionName: 'claim',
        args: [voucher.to, BigInt(voucher.amount), BigInt(voucher.nonce), voucher.signature],
        account,
        chain: sepolia,
      });
      msg.innerHTML = `Claim submitted: <a href="${explorer}/tx/${hash}" target="_blank" rel="noreferrer">${hash.slice(0, 10)}…</a>`;
    } catch (error) {
      button.disabled = false;
      msg.textContent = errorText(error, 'Claim failed.');
    }
  }

  void showOverview();
  return () => {
    active = false;
    session = null;
  };
}
