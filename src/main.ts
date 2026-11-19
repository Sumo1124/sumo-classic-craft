import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { mountGame } from './game';
import { mountAdventure } from './adventure';
import { createGameAudio } from './audio';

// Contract reads use the same-origin read-only proxy. Transactions and
// signatures always stay in the player's own MetaMask wallet.
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http('/api/rpc', { batch: false }),
});

const coinAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
]);
const collectionAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function owner() view returns (address)',
  'function mint(address to, string uri) returns (uint256)',
]);

type Config = {
  chainId: number;
  sumoCoin: Address | null;
  sumoCollection: Address | null;
  claimEnabled: boolean;
  explorer: string;
};
type CollectionItem = { id: number; name: string; description: string; image: string };
type WalletProvider = {
  isMetaMask?: boolean;
  providers?: WalletProvider[];
  on?: (event: string, listener: (value: unknown) => void) => void;
};

const state: {
  account: Address | null;
  config: Config | null;
  collection: { name: string; description: string; items: CollectionItem[] } | null;
  localBalance: number;
} = { account: null, config: null, collection: null, localBalance: 0 };

const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = createGameAudio();
let cleanupGame: (() => void) | null = null;
let cleanupAdventure: (() => void) | null = null;
let currentView: 'dashboard' | 'play' | 'adventure' = 'dashboard';
const injected = (window as { ethereum?: WalletProvider }).ethereum;
const ethereum = injected?.providers?.find((provider) => provider.isMetaMask)
  ?? (injected?.isMetaMask ? injected : null);
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const coins = (amount: number) => amount.toLocaleString('en-US');
const explorerLink = (config: Config, path: string, label: string) =>
  `<a href="${config.explorer}/${path}" target="_blank" rel="noreferrer">${label}</a>`;

function setWalletMessage(message: string) {
  const element = document.querySelector('#wallet-msg');
  if (element) element.textContent = message;
}

function updateLocalBalance(amount: number) {
  state.localBalance = amount;
  document.querySelectorAll('[data-local-balance]').forEach((element) => {
    element.textContent = coins(amount);
  });
}

function updateAccount(account: Address | null) {
  const changed = state.account?.toLowerCase() !== account?.toLowerCase();
  state.account = account;
  if (!changed) return;

  cleanupGame?.();
  cleanupGame = null;
  cleanupAdventure?.();
  cleanupAdventure = null;
  currentView = 'dashboard';
  state.localBalance = 0;
  render();
  if (account) void refreshProgress();
}

function render() {
  if (!state.account) {
    renderWalletGate();
    return;
  }
  renderApp();
}

function renderWalletGate() {
  app.innerHTML = `
    <main class="wallet-gate">
      <section class="gate-art" aria-label="Carrick Vale guardian artwork">
        <img src="/nft/carrick-vale.jpg" alt="The carved guardian of Carrick Vale" />
        <div class="gate-art-caption"><span>THE FIRST REALM</span><strong>Carrick Vale</strong></div>
      </section>
      <section class="gate-content">
        <div class="brand brand-large"><span class="brand-mark" aria-hidden="true">S</span><span>SUMO CLASSIC CRAFT<small>WORLD OF CARRICKCRAFT</small></span></div>
        <p class="eyebrow">A WEB3 GUARDIAN ADVENTURE</p>
        <h1>Enter a world<br />worth <em>remembering.</em></h1>
        <p class="gate-copy">Choose a guardian, clear six untimed chapters, and follow a new daily quest trail to earn SUMO. Your journey begins with your wallet.</p>
        <ul class="gate-features">
          <li><span>01</span><div><strong>Play &amp; earn</strong><small>825 chapter SUMO + 50 local SUMO every UTC day</small></div></li>
          <li><span>02</span><div><strong>Original NFT guardians</strong><small>Eight CarrickCraft artworks, ready for IPFS</small></div></li>
          <li><span>03</span><div><strong>Your keys, your wallet</strong><small>MetaMask signs every clear and Sepolia claim</small></div></li>
        </ul>
        <button id="connect" class="primary connect-large">Connect MetaMask <span aria-hidden="true">→</span></button>
        <p class="wallet-requirement">Sepolia testnet · No wallet credentials are stored here</p>
        <p id="wallet-msg" class="result" role="status" aria-live="polite">${ethereum ? '' : 'MetaMask was not detected. Install or enable the MetaMask extension to enter.'}</p>
      </section>
    </main>`;
  document.querySelector('#connect')!.addEventListener('click', connect);
}

function renderApp() {
  const { account, config } = state;
  if (!account) return;
  app.innerHTML = `
    <header class="site-header">
      <button class="brand brand-button" id="brand-home" aria-label="Sumo Classic Craft home">
        <span class="brand-mark" aria-hidden="true">S</span>
        <span>SUMO CLASSIC CRAFT<small>WORLD OF CARRICKCRAFT</small></span>
      </button>
      <div class="header-actions">
        <button id="audio-toggle" class="audio-toggle" aria-pressed="${!audio.isMuted()}" title="Toggle game sound">${audio.isMuted() ? 'Sound off' : 'Sound on'}</button>
        <span class="network-pill"><i aria-hidden="true"></i> Sepolia</span>
        <button id="connect" class="wallet-button">${short(account)}</button>
      </div>
      <p id="wallet-msg" class="result header-message" role="status" aria-live="polite"></p>
    </header>

    <section class="hero">
      <img class="hero-image" src="/nft/carrick-vale.jpg" alt="The guardian of Carrick Vale" />
      <div class="hero-shade"></div>
      <div class="hero-content">
        <p class="eyebrow">WELCOME TO WORLD OF CARRICKCRAFT</p>
        <h1>Every guardian<br />has a <em>story.</em></h1>
        <p>Master the art of memory at your own pace. Restore the realms.<br />Return each day for a new guardian trail.</p>
        <button id="hero-play" class="primary hero-play">Begin your journey <span aria-hidden="true">→</span></button>
      </div>
      <div class="hero-wallet">
        <span>GAME WALLET</span>
        <strong><b data-local-balance>${coins(state.localBalance)}</b> <small>SUMO</small></strong>
        <p>Earned through guardian trials</p>
      </div>
      <span class="hero-edition">GENESIS COLLECTION · 01</span>
    </section>

    <nav class="tabs" aria-label="Game sections">
      <button id="tab-dashboard" class="tab ${currentView === 'dashboard' ? 'active' : ''}" aria-pressed="${currentView === 'dashboard'}">Overview</button>
      <button id="tab-play" class="tab ${currentView === 'play' ? 'active' : ''}" aria-pressed="${currentView === 'play'}">Guardian Match <span>CHAPTERS + DAILY</span></button>
      <button id="tab-adventure" class="tab ${currentView === 'adventure' ? 'active' : ''}" aria-pressed="${currentView === 'adventure'}">Adventure <span>QUEST + COMBAT</span></button>
    </nav>

    <main id="dashboard-view" ${currentView === 'dashboard' ? '' : 'hidden'}>
      <div class="dashboard-grid">
        <section class="card" id="coin-card">
          <div class="section-heading"><div><p class="eyebrow">YOUR TREASURY</p><h2>Sumo Coin</h2></div><span class="coin-mark">$SUMO</span></div>
          <div id="coin-body">Loading balances…</div>
        </section>
        <section class="card" id="chain-card">
          <div class="section-heading"><div><p class="eyebrow">NETWORK</p><h2>Sepolia testnet</h2></div><span class="status-chip">TESTNET</span></div>
          <div id="chain-body">Loading chain status…</div>
        </section>
      </div>
      <section class="card collection-card" id="collection-card">
        <div class="section-heading collection-heading"><div><p class="eyebrow">THE GENESIS COLLECTION</p><h2>Guardians of CarrickCraft</h2><p>Eight original carved guardians. Eight realms. One world to restore.</p></div><span class="collection-count">08 ARTWORKS</span></div>
        <div id="collection-body">Loading collection…</div>
      </section>
    </main>
    <section id="game-view" ${currentView === 'play' ? '' : 'hidden'}></section>
    <section id="adventure-view" class="adventure-view" ${currentView === 'adventure' ? '' : 'hidden'}></section>
    <footer><span>SUMO CLASSIC CRAFT</span><p>Local adventure · Sepolia testnet · Render-ready</p></footer>`;

  document.querySelector('#connect')!.addEventListener('click', connect);
  document.querySelector<HTMLButtonElement>('#audio-toggle')!.addEventListener('click', (event) => {
    const muted = audio.toggleMute();
    const button = event.currentTarget as HTMLButtonElement;
    button.textContent = muted ? 'Sound off' : 'Sound on';
    button.setAttribute('aria-pressed', String(!muted));
    if (!muted) audio.play('flip');
  });
  document.querySelector('#brand-home')!.addEventListener('click', () => showView('dashboard'));
  document.querySelector('#hero-play')!.addEventListener('click', () => showView('play'));
  document.querySelector('#tab-dashboard')!.addEventListener('click', () => showView('dashboard'));
  document.querySelector('#tab-play')!.addEventListener('click', () => showView('play'));
  document.querySelector('#tab-adventure')!.addEventListener('click', () => showView('adventure'));
  if (config) {
    void renderChain(config);
    void renderCoin(config);
    void renderCollection(config);
  }
  if (currentView === 'play') mountCurrentGame();
  if (currentView === 'adventure') mountCurrentAdventure();
}

async function connect() {
  if (!ethereum) {
    setWalletMessage('MetaMask is required. Install or enable the MetaMask browser extension, then try again.');
    return;
  }
  const button = document.querySelector<HTMLButtonElement>('#connect');
  if (button) button.disabled = true;
  try {
    const wallet = createWalletClient({ chain: sepolia, transport: custom(ethereum as never) });
    await wallet.requestAddresses();
    try {
      await wallet.switchChain({ id: sepolia.id });
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await wallet.addChain({ chain: sepolia });
    }
    const [account] = await wallet.getAddresses();
    if (!account) throw new Error('MetaMask did not provide a connected account.');
    updateAccount(account);
    setWalletMessage('MetaMask connected on Sepolia. Welcome to CarrickCraft.');
  } catch (error) {
    setWalletMessage(error instanceof Error ? error.message : 'MetaMask connection failed.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function refreshProgress() {
  const account = state.account;
  if (!account) return;
  try {
    const response = await fetch(`/api/game/stages?address=${account}`);
    const body = await response.json();
    if (response.ok && state.account === account) updateLocalBalance(Number(body.progress.localBalance ?? 0));
  } catch {
    // The game view reports progress errors with its own retry action.
  }
}

async function renderChain(config: Config) {
  const body = document.querySelector('#chain-body');
  if (!body) return;
  try {
    const [chainId, block] = await Promise.all([
      publicClient.getChainId(),
      publicClient.getBlockNumber(),
    ]);
    body.innerHTML = `
      <dl class="chain-list">
        <div><dt>Network</dt><dd>Sepolia <span class="muted">(${chainId})</span></dd></div>
        <div><dt>Latest block</dt><dd>${block.toString()}</dd></div>
        <div><dt>SumoCoin</dt><dd>${config.sumoCoin ? explorerLink(config, `address/${config.sumoCoin}`, short(config.sumoCoin)) : 'Not deployed'}</dd></div>
        <div><dt>NFT collection</dt><dd>${config.sumoCollection ? explorerLink(config, `address/${config.sumoCollection}`, short(config.sumoCollection)) : 'Not deployed'}</dd></div>
      </dl>
      <p class="hint">Gameplay coins remain available locally even when no contract is configured.</p>`;
  } catch {
    body.innerHTML = '<p class="warn">Sepolia RPC is unreachable.</p><p class="hint">You can still play and earn game SUMO locally. Contract reads and claims need an RPC connection.</p>';
  }
}

async function renderCoin(config: Config) {
  const body = document.querySelector('#coin-body');
  if (!body) return;
  body.innerHTML = `
    <div class="balance-grid">
      <div class="balance-block local-balance"><span>EARNED IN GAME</span><strong><b data-local-balance>${coins(state.localBalance)}</b> <small>SUMO</small></strong><p>Persistent local game balance</p></div>
      <div class="balance-block"><span>ON SEPOLIA</span><strong><b id="sumo-balance">—</b> <small>SUMO</small></strong><p>Wallet token balance</p></div>
    </div>
    <div class="supply-row"><span>On-chain total supply</span><strong id="sumo-supply">—</strong></div>
    <button id="earn-play" class="primary">Play a guardian trial <span aria-hidden="true">→</span></button>
    <p class="hint">${config.sumoCoin
      ? config.claimEnabled
        ? 'First clears also receive a Sepolia claim voucher. MetaMask submits the claim and pays testnet gas.'
        : 'Game SUMO is active. Add SUMO_CLAIM_SIGNER_KEY to enable Sepolia vouchers.'
      : 'Game SUMO is active now. Deploy SumoCoin to enable Sepolia claims later.'}</p>`;
  document.querySelector('#earn-play')!.addEventListener('click', () => showView('play'));
  if (!config.sumoCoin) {
    document.querySelector('#sumo-balance')!.textContent = '0';
    document.querySelector('#sumo-supply')!.textContent = 'Not deployed';
    return;
  }

  const account = state.account;
  try {
    const [supply, balance] = await Promise.all([
      publicClient.readContract({ address: config.sumoCoin, abi: coinAbi, functionName: 'totalSupply' }),
      account
        ? publicClient.readContract({ address: config.sumoCoin, abi: coinAbi, functionName: 'balanceOf', args: [account] })
        : Promise.resolve(0n),
    ]);
    if (account !== state.account) return;
    const balanceElement = document.querySelector('#sumo-balance');
    const supplyElement = document.querySelector('#sumo-supply');
    if (balanceElement) balanceElement.textContent = formatUnits(balance, 18);
    if (supplyElement) supplyElement.textContent = `${formatUnits(supply, 18)} SUMO`;
  } catch {
    const supplyElement = document.querySelector('#sumo-supply');
    if (supplyElement) supplyElement.textContent = 'RPC unavailable';
  }
}

function mountCurrentGame() {
  const gameView = document.querySelector<HTMLElement>('#game-view');
  if (!gameView || !state.account) return;
  cleanupGame = mountGame({
    container: gameView,
    getAccount: () => state.account,
    requestConnect: connect,
    items: state.collection?.items ?? [],
    explorer: state.config?.explorer ?? 'https://sepolia.etherscan.io',
    sumoCoin: state.config?.sumoCoin ?? null,
    onBalance: updateLocalBalance,
    audio,
  });
}

function mountCurrentAdventure() {
  const view = document.querySelector<HTMLElement>('#adventure-view');
  if (!view || !state.account) return;
  cleanupAdventure = mountAdventure({
    container: view,
    getAccount: () => state.account,
    onBalance: updateLocalBalance,
    audio,
  });
}

function showView(view: 'dashboard' | 'play' | 'adventure') {
  if (!state.account) {
    renderWalletGate();
    return;
  }
  cleanupGame?.();
  cleanupGame = null;
  cleanupAdventure?.();
  cleanupAdventure = null;
  currentView = view;
  const dashboard = document.querySelector<HTMLElement>('#dashboard-view')!;
  const gameView = document.querySelector<HTMLElement>('#game-view')!;
  const adventureView = document.querySelector<HTMLElement>('#adventure-view')!;
  dashboard.hidden = view !== 'dashboard';
  gameView.hidden = view !== 'play';
  adventureView.hidden = view !== 'adventure';
  for (const name of ['dashboard', 'play', 'adventure']) {
    const tab = document.querySelector(`#tab-${name}`)!;
    tab.classList.toggle('active', view === name);
    tab.setAttribute('aria-pressed', String(view === name));
  }
  if (view === 'dashboard' && state.config) {
    void refreshProgress();
    void renderChain(state.config);
    void renderCoin(state.config);
    void renderCollection(state.config);
  } else if (view === 'play') {
    mountCurrentGame();
  } else if (view === 'adventure') {
    mountCurrentAdventure();
  }
}

async function renderCollection(config: Config) {
  const body = document.querySelector('#collection-body');
  if (!body) return;
  const collection = state.collection;
  body.innerHTML = `
    <p class="collection-description">${collection?.description ?? 'Original guardian artwork from World of CarrickCraft.'}</p>
    <div id="collection-stats" class="collection-stats"><span class="muted">Checking Sepolia collection…</span></div>
    <div id="mint-container"></div>
    <div class="grid">${(collection?.items ?? []).map((item) => `
      <figure>
        <div class="art-frame"><img src="${item.image}" alt="${item.name}" loading="lazy" /><span>${String(item.id).padStart(2, '0')}</span></div>
        <figcaption><strong>${item.name}</strong><span>${item.description}</span><small>CARRICKCRAFT GUARDIAN</small></figcaption>
      </figure>`).join('')}</div>`;

  const stats = document.querySelector('#collection-stats')!;
  if (!config.sumoCollection) {
    stats.innerHTML = '<span>LOCAL PREVIEW</span><p>Original artwork is ready for Pinata/IPFS. Configure the Sepolia collection to enable minting.</p>';
    return;
  }

  try {
    const [supply, owner] = await Promise.all([
      publicClient.readContract({ address: config.sumoCollection, abi: collectionAbi, functionName: 'totalSupply' }),
      publicClient.readContract({ address: config.sumoCollection, abi: collectionAbi, functionName: 'owner' }),
    ]);
    const mine = state.account
      ? await publicClient.readContract({ address: config.sumoCollection, abi: collectionAbi, functionName: 'balanceOf', args: [state.account] })
      : 0n;
    stats.innerHTML = `<dl><div><dt>Minted</dt><dd>${supply.toString()} / 5000</dd></div><div><dt>You own</dt><dd>${mine.toString()}</dd></div></dl>`;
    if (state.account?.toLowerCase() === owner.toLowerCase()) {
      const mintContainer = document.querySelector('#mint-container')!;
      mintContainer.innerHTML = `
        <form id="mint-form">
          <label>Mint to <input id="mint-to" value="${state.account}" /></label>
          <label>Metadata URI <input id="mint-uri" placeholder="ipfs://CID" required /></label>
          <button class="primary" type="submit">Mint guardian NFT</button>
        </form>
        <p id="mint-result" class="result" role="status" aria-live="polite"></p>`;
      document.querySelector<HTMLFormElement>('#mint-form')!.addEventListener('submit', (event) => void mint(config, event));
    }
  } catch {
    stats.innerHTML = '<span>SEPOLIA UNAVAILABLE</span><p>The original local gallery remains available. Contract reads failed.</p>';
  }
}

async function mint(config: Config, event: SubmitEvent) {
  event.preventDefault();
  const result = document.querySelector('#mint-result')!;
  const to = document.querySelector<HTMLInputElement>('#mint-to')!.value;
  if (!state.account || !ethereum || !config.sumoCollection) return;
  if (!isAddress(to)) {
    result.textContent = 'Enter a valid recipient wallet address.';
    return;
  }
  try {
    const wallet = createWalletClient({ chain: sepolia, transport: custom(ethereum as never) });
    const hash = await wallet.writeContract({
      address: config.sumoCollection,
      abi: collectionAbi,
      functionName: 'mint',
      args: [to, document.querySelector<HTMLInputElement>('#mint-uri')!.value],
      account: state.account,
      chain: sepolia,
    });
    result.innerHTML = `Mint submitted: ${explorerLink(config, `tx/${hash}`, short(hash))}`;
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : 'Mint failed.';
  }
}

const [configResponse, collectionResponse] = await Promise.all([
  fetch('/api/config'),
  fetch('/api/collection'),
]);
state.config = await configResponse.json();
state.collection = await collectionResponse.json();
render();
ethereum?.on?.('accountsChanged', (accounts) => {
  const value = Array.isArray(accounts) ? accounts[0] : null;
  const account = typeof value === 'string' && isAddress(value) ? value : null;
  updateAccount(account);
  setWalletMessage(account
    ? `Active MetaMask wallet: ${short(account)}.`
    : 'MetaMask disconnected. Connect again to re-enter CarrickCraft.');
});
ethereum?.on?.('chainChanged', (chainId) => {
  setWalletMessage(chainId === '0xaa36a7'
    ? 'MetaMask is on Sepolia.'
    : 'Switch MetaMask to Sepolia before signing or claiming on-chain rewards.');
});
window.addEventListener('pagehide', () => {
  cleanupGame?.();
  cleanupAdventure?.();
  audio.destroy();
}, { once: true });
