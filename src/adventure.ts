import type { Address } from 'viem';
import type { GameAudio } from './audio';
import { startBattle3D, type BattleHandle, type FighterLook, type HudSnapshot } from './battle3d';

type Ability = {
  id: string; name: string; icon: string; cost: number; cooldown: number;
  description: string; type: string;
};
type AdventureClass = {
  id: string; name: string; title: string; resourceName: string;
  portrait: string; blurb: string;
};
type Player = AdventureClass & {
  className: string; level: number; xp: number; xpNext: number;
  hp: number; maxHp: number; resource: number; resourceMax: number;
  attack: number; spell: number; armor: number; crit: number; sumoEarned: number;
  equipment: Record<'weapon' | 'armor' | 'trinket', Item | null>;
  abilities: Ability[];
};
type QuestObjective = { label: string; current: number; required: number; done: boolean };
type Quest = {
  id: string; name: string; npc: string; text: string; completionText: string; label: string;
  objectives: QuestObjective[];
  current: number; required: number;
  state: 'locked' | 'available' | 'active' | 'ready' | 'done';
  lockedReason: string | null;
  canTurnIn: boolean;
  rewards: { xp: number; sumo: number; items: Record<string, number>; classItem?: string | null };
};
type Mob = {
  id: string; name: string; level: number; hp: number; art: string; xp: number; sumo: number;
  requiresQuest?: string | null; locked?: boolean;
};
type Zone = {
  id: string; name: string; minLevel: number; art: string; blur: string; music: string | null;
  unlocked: boolean; cleared: boolean;
  mobs: Mob[];
  boss: Mob & {
    defeated: boolean; title: string | null; taunt: string | null;
    requiresQuest?: string | null; locked?: boolean;
  };
  quests: Quest[];
};
type LogEntry = { kind: string; text: string; amount?: number };
type Status = { name: string; perTurn: number; left: number };
type Battle = {
  id: string; zoneId: string; mobId: string; kind: 'mob' | 'boss';
  turn: number; status: string;
  enemy: {
    id: string; name: string; art: string; level: number; hp: number; maxHp: number;
    xp: number; sumo: number; armor: number;
    min?: number; max?: number;
    special: { name: string; chance?: number } | null;
  };
  playerHp: number; playerResource: number; shield: number;
  cooldowns: Record<string, number>;
  stun: { player: number; enemy: number };
  buffs: {
    attackPct: number; spellPct: number; nextAttack: number; turns: number;
    weakenPct: number; weakenTurns: number;
    playerWeakenPct: number; playerWeakenTurns: number;
  };
  dots: { player: Status[]; enemy: Status[] };
  hots: { player: Status[] };
  log: LogEntry[];
};
type Result = {
  kind: 'victory' | 'defeat' | 'quest' | 'flee' | 'harvest';
  title: string; message: string;
  xp: number; sumo: number; items: Record<string, number>; levels: number; loot: string[];
  conquest?: number;
};
type BattleFx = {
  enemy: number; player: number; heal: number; crit: boolean;
  mode: 'melee' | 'spell' | 'support' | 'defend' | 'item';
  school: string; retaliate: boolean; key: number;
};
type Item = {
  id: string; name: string; kind: string; icon: string; count: number;
  description: string; heal?: number; restore?: number;
  slot?: 'weapon' | 'armor' | 'trinket'; reqLevel?: number;
  stats?: { attack?: number; spell?: number; armor?: number; hp?: number; crit?: number };
};
type Farm =
  | {
      crops: { id: string; name: string; icon: string; growMs: number; yield: { itemId: string; count: number } }[];
      plots: { index: number; crop: { id: string; name: string; icon: string } | null; ready: boolean; remainingMs: number }[];
    }
  | null;
type Overview = {
  player: Player | null;
  localBalance: number;
  classes: AdventureClass[];
  zones: Zone[];
  battle: Battle | null;
  lastResult: Result | null;
  inventory: Item[];
  farm: Farm;
  items: Record<string, { name: string; icon: string }>;
};

type MountArgs = {
  container: HTMLElement;
  getAccount: () => Address | null;
  onBalance: (amount: number) => void;
  audio: GameAudio;
};

const CAST_CLIP: Record<string, string> = {
  fire: 'cast_fire', frost: 'cast_frost', arcane: 'cast_arcane', holy: 'cast_holy',
  shadow: 'cast_shadow', nature: 'cast_nature',
};
const ABILITY_ICON: Record<string, string> = {
  reaver_strike: 'strike', iron_bellow: 'buff', onrush: 'stun', quaking_blow: 'heavy', execute: 'execute',
  cinderbolt: 'fire', rimelance: 'frost', aether_insight: 'arcane', frost_nova: 'frost', arcane_barrier: 'shield',
  sinister_strike: 'quick', backstab: 'quick', eviscerate: 'execute', stealth: 'shadow', recuperate: 'heal',
  smite: 'holy', greater_heal: 'heal', shadow_word_pain: 'shadow', power_word_shield: 'shield', renew: 'nature',
  steady_shot: 'strike', aimed_shot: 'quick', serpent_sting: 'venom', concussive_shot: 'stun', field_dressing: 'heal',
  crusader_strike: 'strike', holy_light: 'holy', judgment: 'holy', divine_shield: 'shield', consecration: 'holy',
  wrath: 'nature', moonfire: 'arcane', rejuvenation: 'heal', barkskin: 'shield', starfire: 'arcane',
  lightning_bolt: 'nature', flame_shock: 'fire', healing_wave: 'heal', frost_shock: 'frost', storm_totem: 'buff',
  shadow_bolt: 'shadow', corruption: 'shadow', drain_life: 'shadow', howl_of_terror: 'stun', soul_fire: 'fire',
};
const BOSS_MUSIC: Record<string, string> = {
  'eastbrook-vale': 'boss_crypt_knellwyrm',
  'mirefen-marsh': 'boss_mere_hydra',
  'thornpeak-heights': 'boss_korgath_the_bound',
  drakelands: 'boss_korzul_the_gravewyrm',
  willowfen: 'boss_crypt_knellwyrm',
};
const HERO_ART: Record<string, string> = {
  warrior: '/woc/heroes/warrior.webp',
  mage: '/woc/heroes/mage.webp',
  rogue: '/woc/heroes/rogue.webp',
  priest: '/woc/heroes/priest.webp',
  hunter: '/woc/heroes/hunter.webp',
  paladin: '/woc/heroes/paladin.webp',
  druid: '/woc/heroes/druid.webp',
  shaman: '/woc/heroes/shaman.webp',
  warlock: '/woc/heroes/warlock.webp',
};
const ANTAGONIST_ART: Record<string, string> = {
  barrow_king: '/woc/antagonists/barrow_king.jpg',
  mere_hydra: '/woc/antagonists/mere_hydra.jpg',
  korgath: '/woc/antagonists/korgath.jpg',
  korzul: '/woc/antagonists/korzul.jpg',
  ancient_guardian: '/woc/antagonists/ancient_guardian.jpg',
  morthen: '/woc/bosses/morthen.webp',
};
type ModelRef = { url: string; height: number };
const HERO_MODEL: Record<string, ModelRef> = {
  warrior: { url: '/woc/cc/players/knight.glb', height: 1.85 },
  mage: { url: '/woc/cc/players/mage.glb', height: 1.85 },
  rogue: { url: '/woc/cc/players/rogue.glb', height: 1.82 },
  priest: { url: '/woc/cc/players/mage.glb', height: 1.83 },
  hunter: { url: '/woc/cc/players/ranger.glb', height: 1.85 },
  paladin: { url: '/woc/cc/players/paladin.glb', height: 1.9 },
  druid: { url: '/woc/cc/players/druid.glb', height: 1.86 },
  shaman: { url: '/woc/cc/players/barbarian.glb', height: 1.88 },
  warlock: { url: '/woc/cc/players/mage.glb', height: 1.85 },
};
const MOB_MODEL: Record<string, ModelRef> = {
  forest_wolf: { url: '/woc/cc/mobs/wolf.glb', height: 1.25 },
  thicket_boar: { url: '/woc/cc/mobs/wild_boar.glb', height: 1.1 },
  wild_boar: { url: '/woc/cc/mobs/wild_boar.glb', height: 1.15 },
  webwood_spider: { url: '/woc/cc/mobs/spider.glb', height: 0.95 },
  mudfin_murloc: { url: '/woc/cc/mobs/glubevolved.glb', height: 1.2 },
  vale_bandit: { url: '/woc/cc/mobs/woc_crypt_ossuary_cutthroat.glb', height: 1.85 },
  downs_bandit: { url: '/woc/cc/mobs/woc_crypt_ossuary_cutthroat.glb', height: 1.85 },
  tunnel_rat: { url: '/woc/cc/mobs/kobold.glb', height: 1.05 },
  restless_bones: { url: '/woc/cc/mobs/woc_skeleton_minion.glb', height: 1.85 },
  greyjaw: { url: '/woc/cc/mobs/greyjaw.glb', height: 1.5 },
  gorrak: { url: '/woc/cc/mobs/woc_crypt_ossuary_cutthroat.glb', height: 1.95 },
  mogger: { url: '/woc/cc/mobs/ogre.glb', height: 2.6 },
  sexton_marrow: { url: '/woc/cc/mobs/woc_crypt_sexton_marrow.glb', height: 2.05 },
  morthen: { url: '/woc/cc/mobs/woc_crypt_morthen.glb', height: 2.2 },
  deepfen_murloc: { url: '/woc/cc/mobs/glubevolved.glb', height: 1.45 },
  fen_troll: { url: '/woc/cc/mobs/orc.glb', height: 2.2 },
  mirefen_raptor: { url: '/woc/cc/mobs/velociraptor.glb', height: 1.65 },
  bog_wraith: { url: '/woc/cc/mobs/ghost.glb', height: 1.9 },
  mere_hydra: { url: '/woc/cc/mobs/woc_temple_hydra.glb', height: 3.2 },
  snowdrift_wolf: { url: '/woc/cc/mobs/wolf.glb', height: 1.35 },
  ice_wraith: { url: '/woc/cc/mobs/temple_ice_wraith.glb', height: 2.0 },
  thornpeak_ogre: { url: '/woc/cc/mobs/ogre.glb', height: 2.75 },
  deeprock_kobold: { url: '/woc/cc/mobs/kobold.glb', height: 1.15 },
  frostmane_yeti: { url: '/woc/cc/mobs/yeti.glb', height: 2.45 },
  korgath: { url: '/woc/cc/mobs/woc_sanctum_korgath.glb', height: 3.1 },
  emberwing_drake: { url: '/woc/cc/mobs/dragonkin_mob.glb', height: 2.15 },
  rift_stone_ogre: { url: '/woc/cc/mobs/balgath_cyclops.glb', height: 3.0 },
  skeleton_warrior: { url: '/woc/cc/mobs/woc_crypt_ossuary_warrior.glb', height: 1.95 },
  ogre_crusher: { url: '/woc/cc/mobs/ogre.glb', height: 2.85 },
  reliquary_wraith: { url: '/woc/cc/mobs/mist_chanter.glb', height: 2.0 },
  korzul: { url: '/woc/cc/mobs/woc_sanctum_korzul.glb', height: 3.7 },
  pact_imp: { url: '/woc/cc/mobs/emberkin.glb', height: 1.25 },
  willowfen_troll: { url: '/woc/cc/mobs/orcenemy.glb', height: 2.35 },
  hoard_bat: { url: '/woc/cc/mobs/hoard_boss_bat.glb', height: 1.65 },
  ancient_guardian: { url: '/woc/cc/mobs/woc_temple_colossus.glb', height: 3.25 },
};
const MOB_ARCHETYPE: Record<string, string> = {
  forest_wolf: 'beast', thicket_boar: 'beast', wild_boar: 'beast', webwood_spider: 'beast',
  mirefen_raptor: 'beast', snowdrift_wolf: 'beast', frostmane_yeti: 'beast',
  vale_bandit: 'bandit', downs_bandit: 'bandit',
  mudfin_murloc: 'reptile', deepfen_murloc: 'reptile', emberwing_drake: 'reptile',
  bog_wraith: 'undead', ice_wraith: 'undead', skeleton_warrior: 'undead', reliquary_wraith: 'undead',
  fen_troll: 'giant', thornpeak_ogre: 'giant', rift_stone_ogre: 'giant', ogre_crusher: 'giant', willowfen_troll: 'giant',
  deeprock_kobold: 'imp', pact_imp: 'imp', hoard_bat: 'imp',
};
const heroArt = (player: Player) => HERO_ART[player.id] ?? player.portrait;

const HERO_LOOK: Record<string, FighterLook> = {
  warrior: { body: 0x6c7785, trim: 0xd6a65a, skin: 0xd9b08c, metal: 0xd3dae2, scale: 1, weapon: 'sword', hooded: false },
  mage: { body: 0x3c4f8c, trim: 0x86b4ff, skin: 0xe0bc98, metal: 0xa8bfe8, scale: 0.98, weapon: 'staff', hooded: true },
  rogue: { body: 0x2f3a33, trim: 0x8fb98c, skin: 0xcfae8e, metal: 0xc2c9ce, scale: 0.95, weapon: 'sword', hooded: true },
  priest: { body: 0xd8cfb4, trim: 0xf0d98a, skin: 0xe2c2a0, metal: 0xeadcae, scale: 0.97, weapon: 'staff', hooded: true },
  hunter: { body: 0x4a5a35, trim: 0x9b7a44, skin: 0xd3ac86, metal: 0xbcc5cb, scale: 0.98, weapon: 'axe', hooded: false },
  paladin: { body: 0x8a8f99, trim: 0xe8c97a, skin: 0xdcb492, metal: 0xe6ebf1, scale: 1.03, weapon: 'sword', hooded: false },
  druid: { body: 0x4c5d3a, trim: 0x9ac07a, skin: 0xcfb28c, metal: 0xc4cdb0, scale: 1, weapon: 'staff', hooded: true },
  shaman: { body: 0x3f5a58, trim: 0x7fd0c4, skin: 0xd5b08e, metal: 0xadccc8, scale: 0.99, weapon: 'club', hooded: false },
  warlock: { body: 0x3a2c46, trim: 0x9b6ad0, skin: 0xd4b394, metal: 0x9682b0, scale: 0.98, weapon: 'staff', hooded: true },
};
const ENEMY_LOOK: Record<string, FighterLook> = {
  beast: { body: 0x6b4a2f, trim: 0x3d2a1a, skin: 0x5b3f28, metal: 0xa9a29a, scale: 1.05, weapon: 'claw', hooded: false },
  bandit: { body: 0x5a3b34, trim: 0x241a17, skin: 0xd0a680, metal: 0xb6bcc2, scale: 1, weapon: 'axe', hooded: true },
  reptile: { body: 0x3f6250, trim: 0x25392f, skin: 0x6f9a72, metal: 0xa3b3ab, scale: 0.96, weapon: 'claw', hooded: false },
  undead: { body: 0x4a5348, trim: 0x2a3129, skin: 0x9fae93, metal: 0x9aa39a, scale: 1, weapon: 'sword', hooded: true },
  giant: { body: 0x54483a, trim: 0x2f271d, skin: 0x9c7f61, metal: 0x918b85, scale: 1.42, weapon: 'club', hooded: false },
  imp: { body: 0x6b2c2c, trim: 0x2b1212, skin: 0xb6593f, metal: 0xc0997f, scale: 0.82, weapon: 'claw', hooded: false },
};
const BOSS_LOOK: Record<string, FighterLook> = {
  barrow_king: { body: 0x3f4a44, trim: 0xb89a52, skin: 0x9aa892, metal: 0xdcd6bc, scale: 1.18, weapon: 'sword', hooded: true },
  mere_hydra: { body: 0x35564a, trim: 0x6fae8c, skin: 0x5f8f72, metal: 0xacc3ac, scale: 1.3, weapon: 'claw', hooded: false },
  korgath: { body: 0x4a3b2e, trim: 0x8a5f34, skin: 0x8f7355, metal: 0x9f9180, scale: 1.35, weapon: 'axe', hooded: false },
  korzul: { body: 0x3a2f3f, trim: 0x8f6ab0, skin: 0x8f8a9a, metal: 0xb4aac4, scale: 1.4, weapon: 'axe', hooded: true },
  ancient_guardian: { body: 0x4f5b52, trim: 0x9fb98f, skin: 0x7f8f7a, metal: 0xc3cdbc, scale: 1.3, weapon: 'club', hooded: false },
};
const DEFAULT_ENEMY_LOOK: FighterLook = {
  body: 0x51463a, trim: 0x2f2822, skin: 0xc5a184, metal: 0xb0b6bc, scale: 1, weapon: 'sword', hooded: false,
};

function heroLook(player: Player): FighterLook {
  return HERO_LOOK[player.id] ?? HERO_LOOK.warrior;
}

function enemyLook(battle: Battle): FighterLook {
  if (battle.kind === 'boss' && BOSS_LOOK[battle.enemy.id]) return BOSS_LOOK[battle.enemy.id];
  const archetype = MOB_ARCHETYPE[battle.enemy.id];
  return (archetype ? ENEMY_LOOK[archetype] : null) ?? DEFAULT_ENEMY_LOOK;
}
const enemyArt = (battle: Battle) => {
  if (battle.kind === 'boss' && ANTAGONIST_ART[battle.enemy.id]) return ANTAGONIST_ART[battle.enemy.id];
  const archetype = MOB_ARCHETYPE[battle.enemy.id];
  return archetype ? `/woc/battlers/${archetype}.jpg` : battle.enemy.art;
};
const coin = (amount: number) => amount.toLocaleString('en-US');

async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? 'The adventure request failed.');
  return data as T;
}

export function mountAdventure({ container, getAccount, onBalance, audio }: MountArgs) {
  let active = true;
  let state: Overview | null = null;
  let zoneId: string | null = null;
  let busy = false;
  let notice = '';
  let showBag = false;
  let ticker: number | null = null;
  let battle3d: BattleHandle | null = null;

  const zone = () => state?.zones.find((entry) => entry.id === zoneId) ?? state?.zones[0] ?? null;
  const account = () => getAccount();

  function setBusy(value: boolean) {
    busy = value;
    container.classList.toggle('avo-busy', value);
    container.setAttribute('aria-busy', String(value));
  }

  async function refresh(body?: { url: string; payload: unknown }) {
    const address = account();
    if (!address) {
      container.innerHTML = '<div class="avo-empty"><p class="eyebrow">ADVENTURE</p><h3>Connect MetaMask to begin.</h3></div>';
      return;
    }
    setBusy(true);
    try {
      state = body
        ? await api<Overview>(body.url, body.payload)
        : await api<Overview>(`/api/adventure?address=${encodeURIComponent(address)}`);
      if (!active) return;
      if (state!.localBalance > 0) onBalance(state!.localBalance);
      if (!zoneId || !state!.zones.some((entry) => entry.id === zoneId)) {
        zoneId = state!.zones.find((entry) => !entry.cleared && entry.unlocked)?.id ?? state!.zones[0]?.id ?? null;
      }
      notice = '';
    } catch (error) {
      notice = error instanceof Error ? error.message : 'Could not reach the adventure.';
      if (active) audio.playClip('/woc/audio/ui_error.mp3', 0.4);
    } finally {
      if (active) {
        setBusy(false);
        render();
      }
    }
  }

  function act(url: string, payload: unknown) {
    if (busy) return Promise.resolve();
    return refresh({ url, payload: { ...(payload as object), address: account() } });
  }

  function disposeBattle3D() {
    if (battle3d) {
      battle3d.dispose();
      battle3d = null;
    }
  }

  function onKey(event: KeyboardEvent) {
    if (!active || !state?.battle) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key.toLowerCase() === 'f' && !event.repeat) {
      event.preventDefault();
      audio.playClip('/woc/audio/ui_weapon_sheathe.mp3', 0.4);
      void act('/api/adventure/battle/flee', {});
    }
  }

  function render() {
    if (!active) return;
    if (!state) {
      container.innerHTML = '<div class="avo-empty"><p class="eyebrow">ADVENTURE</p><h3>Loading the realm…</h3></div>';
      return;
    }
    if (!state.player) {
      renderClassSelect();
      return;
    }
    renderAdventure();
  }

  function renderClassSelect() {
    const classes = state!.classes;
    container.innerHTML = `
      <div class="avo-intro">
        <p class="eyebrow">WORLD OF CARRICKCRAFT · ADVENTURE</p>
        <h2>Choose your path</h2>
        <p>${classes.length} disciplines, five frontier zones, and real-time combat behind every quest. Pick a class once; your hero keeps their progress.</p>
      </div>
      <div class="avo-class-grid">
        ${classes.map((entry) => `
          <button class="avo-class-card" data-class="${entry.id}">
            <span class="avo-class-art"><img src="${HERO_ART[entry.id] ?? entry.portrait}" alt="${entry.name}" loading="lazy" /></span>
            <span class="avo-class-copy">
              <small>${entry.title}</small>
              <strong>${entry.name}</strong>
              <em>${entry.resourceName}</em>
              <span>${entry.blurb}</span>
            </span>
          </button>`).join('')}
      </div>
      ${notice ? `<p class="avo-notice" role="alert">${escapeHtml(notice)}</p>` : ''}`;
    container.querySelectorAll<HTMLButtonElement>('[data-class]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/cast_holy.mp3', 0.4);
        void act('/api/adventure/class', { className: button.dataset.class });
      });
    });
  }

  function renderAdventure() {
    const player = state!.player!;
    const current = zone();
    const battle = state!.battle;
    disposeBattle3D();
    container.innerHTML = `
      <div class="avo-header">
        <div class="avo-portrait"><img src="${heroArt(player)}" alt="${player.name}" /></div>
        <div class="avo-identity">
          <p class="eyebrow">${player.title}</p>
          <h2>${player.name} <small>Level ${player.level}</small></h2>
          <div class="avo-xp"><i style="width:${Math.min(100, player.xpNext ? player.xp / player.xpNext * 100 : 0)}%"></i><span>${player.xp} / ${player.xpNext} XP</span></div>
          <div class="avo-combat-stats">
            <span>ATK <b>${player.attack}</b></span>
            <span>SPELL <b>${player.spell}</b></span>
            <span>ARMOR <b>${player.armor}</b></span>
            <span>CRIT <b>${player.crit}%</b></span>
          </div>
        </div>
        <div class="avo-vitals">
          <div class="avo-bar hp"><i style="width:${player.maxHp ? player.hp / player.maxHp * 100 : 0}%"></i><span>${player.hp} / ${player.maxHp} HP</span></div>
          <div class="avo-bar res"><i style="width:${player.resourceMax ? player.resource / player.resourceMax * 100 : 0}%"></i><span>${player.resource} / ${player.resourceMax} ${player.resourceName}</span></div>
        </div>
        <div class="avo-summary">
          <div><span>WALLET</span><strong>${coin(state!.localBalance)} SUMO</strong></div>
          <div><span>QUEST SUMO</span><strong>${coin(player.sumoEarned)}</strong></div>
          <div class="avo-header-actions">
            <button data-act="rest">Rest</button>
            <button data-act="bag">Bag</button>
          </div>
        </div>
      </div>

      ${showBag ? renderBag() : ''}

      <div class="avo-zone-tabs">
        ${state!.zones.map((entry) => `
          <button class="${entry.id === current?.id ? 'active' : ''}" data-zone="${entry.id}" ${entry.unlocked ? '' : 'disabled'}>
            <span>${entry.minLevel <= player.level ? 'OPEN' : `LEVEL ${entry.minLevel}`}</span>${entry.name}
            ${entry.cleared ? '<i>✓</i>' : ''}
          </button>`).join('')}
      </div>

      ${current ? renderZone(current, player) : ''}

      ${renderFarm(player)}

      ${notice ? `<p class="avo-notice" role="alert">${escapeHtml(notice)}</p>` : ''}
      ${battle ? renderBattle(battle, player) : ''}
      ${!battle && state!.lastResult ? renderResult(state!.lastResult) : ''}`;

    bindAdventure(player, current);
    if (battle) mountBattle3D(battle, player);
    syncMusic(battle ?? null);
    scheduleFarmTick();
  }

  function mountBattle3D(battle: Battle, player: Player) {
    const canvas = container.querySelector<HTMLCanvasElement>('.avo-stage');
    if (!canvas) return;
    const enemyBar = container.querySelector<HTMLElement>('[data-enemy-hp]');
    const enemyText = container.querySelector<HTMLElement>('[data-enemy-text]');
    const playerBar = container.querySelector<HTMLElement>('[data-player-hp]');
    const playerText = container.querySelector<HTMLElement>('[data-player-text]');
    const resBar = container.querySelector<HTMLElement>('[data-resource]');
    const resText = container.querySelector<HTMLElement>('[data-resource-text]');
    const logEl = container.querySelector<HTMLElement>('[data-log]');
    const clockEl = container.querySelector<HTMLElement>('[data-clock]');

    const setBar = (element: HTMLElement | null, pct: number) => {
      if (element) element.style.width = `${clampPct(pct)}%`;
    };
    let lastLog = '';

    const heroModel = HERO_MODEL[player.id] ?? null;
    const enemyModel = MOB_MODEL[battle.enemy.id] ?? null;
    const handle = startBattle3D(canvas, {
      hero: heroLook(player),
      enemy: enemyLook(battle),
      enemyName: battle.enemy.name,
      playerName: player.name,
      heroModel: heroModel?.url ?? null,
      heroModelHeight: heroModel?.height,
      enemyModel: enemyModel?.url ?? null,
      enemyModelHeight: enemyModel?.height,
      zoneId: battle.zoneId,
      playerHp: battle.playerHp,
      playerMaxHp: player.maxHp,
      resource: battle.playerResource,
      resourceMax: player.resourceMax,
      playerAttack: player.attack,
      playerCrit: player.crit,
      playerArmor: player.armor,
      playerLevel: player.level,
      enemyHp: battle.enemy.hp,
      enemyMaxHp: battle.enemy.maxHp,
      enemyMin: battle.enemy.min ?? Math.round(battle.enemy.maxHp * 0.02),
      enemyMax: battle.enemy.max ?? Math.round(battle.enemy.maxHp * 0.035),
      enemyArmor: battle.enemy.armor,
      enemyLevel: battle.enemy.level,
      abilities: player.abilities.map((ability) => ({
        id: ability.id,
        name: ability.name,
        cost: ability.cost,
        cooldown: ability.cooldown,
        type: ability.type,
        school: abilitySchool(ability.id),
      })),
      onHud(hud: HudSnapshot) {
        setBar(enemyBar, hud.enemyHp / hud.enemyMaxHp * 100);
        if (enemyText) enemyText.textContent = `${hud.enemyHp} / ${hud.enemyMaxHp}`;
        setBar(playerBar, hud.playerHp / hud.playerMaxHp * 100);
        if (playerText) playerText.textContent = `${hud.playerHp} / ${hud.playerMaxHp}`;
        setBar(resBar, hud.resource / hud.resourceMax * 100);
        if (resText) resText.textContent = `${hud.resource} / ${hud.resourceMax} ${player.resourceName}`;
        if (clockEl) clockEl.textContent = formatMs(hud.elapsedMs);
        const joined = hud.log.join('|');
        if (logEl && joined !== lastLog) {
          lastLog = joined;
          logEl.innerHTML = hud.log.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
        }
        container.querySelectorAll<HTMLButtonElement>('[data-rt-ability]').forEach((button) => {
          const remaining = hud.cooldowns[button.dataset.rtAbility!] ?? 0;
          const cost = Number(button.dataset.cost ?? 0);
          button.disabled = remaining > 0 || hud.resource < cost || hud.phase !== 'fight';
          const badge = button.querySelector('small');
          if (badge) badge.textContent = remaining > 0 ? `${remaining.toFixed(1)}s` : cost > 0 ? `${cost}` : 'Free';
        });
        container.querySelectorAll<HTMLButtonElement>('[data-rt-action]').forEach((button) => {
          button.disabled = hud.phase !== 'fight';
        });
      },
      onEnd(report) {
        disposeBattle3D();
        void act('/api/adventure/battle/resolve', {
          battleId: battle.id,
          outcome: report.win ? 'victory' : 'defeat',
          playerHp: report.playerHp,
          resource: report.resource,
          hits: report.hits,
          durationMs: report.durationMs,
          items: report.items,
        }).then(() => {
          if (active) playResultSounds();
        });
      },
      audio: { playClip: (src, volume) => audio.playClip(src, volume) },
    });

    battle3d = handle;
  }

  function renderBag() {
    const player = state!.player!;
    const items = state!.inventory;
    const usable = items.filter((item) => item.heal || item.restore);
    const gear = items.filter((item) => item.slot);
    const trophies = items.filter((item) => !item.slot && !item.heal && !item.restore);
    const slots: Array<'weapon' | 'armor' | 'trinket'> = ['weapon', 'armor', 'trinket'];
    return `
      <section class="avo-bag">
        <div class="avo-section-head"><div><p class="eyebrow">TRAVEL BAG</p><h3>Supplies and gear</h3></div><button data-act="bag">Close</button></div>
        <div class="avo-equip-row">
          ${slots.map((slot) => {
            const item = player.equipment[slot];
            return `<div class="avo-equip ${item ? '' : 'empty'}">
              ${item ? `<img src="${item.icon}" alt="" />` : '<span class="avo-equip-empty">+</span>'}
              <div><small>${slot}</small><strong>${item ? item.name : 'Empty slot'}</strong><span>${item ? statText(item) : 'Equip gear from your bag'}</span></div>
              ${item ? `<button data-unequip="${slot}">Remove</button>` : ''}
            </div>`;
          }).join('')}
        </div>
        ${usable.length ? `<div class="avo-bag-section"><h4>Consumables</h4><div class="avo-bag-grid">${usable.map((item) => `
          <div class="avo-item">
            <img src="${item.icon}" alt="" />
            <div><strong>${item.name} <small>×${item.count}</small></strong><span>${item.description}</span></div>
            <button data-use="${item.id}">Use</button>
          </div>`).join('')}</div></div>` : ''}
        ${gear.length ? `<div class="avo-bag-section"><h4>Equipment</h4><div class="avo-bag-grid">${gear.map((item) => {
          const locked = (item.reqLevel ?? 1) > player.level;
          return `<div class="avo-item ${locked ? 'locked' : ''}">
            <img src="${item.icon}" alt="" />
            <div><strong>${item.name} <small>×${item.count}</small></strong><span>${statText(item)}</span>
            <em>${item.slot}${item.reqLevel && item.reqLevel > 1 ? ` · requires level ${item.reqLevel}` : ''}</em></div>
            <button data-equip="${item.id}" ${locked ? 'disabled' : ''}>${locked ? `Lv ${item.reqLevel}` : 'Equip'}</button>
          </div>`;
        }).join('')}</div></div>` : ''}
        ${trophies.length ? `<div class="avo-bag-section"><h4>Materials</h4><div class="avo-bag-grid">${trophies.map((item) => `
          <div class="avo-item">
            <img src="${item.icon}" alt="" />
            <div><strong>${item.name} <small>×${item.count}</small></strong><span>${item.description}</span></div>
          </div>`).join('')}</div></div>` : ''}
        ${items.length === 0 ? '<p class="avo-muted">Your bag is empty. Win fights or harvest the homestead.</p>' : ''}
      </section>`;
  }

  function renderZone(current: Zone, player: Player) {
    if (!current.unlocked) {
      return `<section class="avo-zone locked">
        <div class="avo-zone-banner" style="background-image:url('${current.art}')"><div><p class="eyebrow">LOCKED</p><h3>${current.name}</h3><small>Reach level ${current.minLevel} to enter.</small></div></div>
      </section>`;
    }
    return `
      <section class="avo-zone">
        <div class="avo-zone-banner" style="background-image:url('${current.art}')">
          <div>
            <p class="eyebrow">${current.cleared ? 'RESTORED' : 'ADVENTURE ZONE'}</p>
            <h3>${current.name}</h3>
            <small>${current.blur}</small>
          </div>
          <button data-act="rest" class="avo-camp">Rest at camp</button>
        </div>
        <div class="avo-zone-body">
          <div class="avo-foes">
            <div class="avo-section-head"><h3>Enemies</h3><span>Level ${player.level}</span></div>
            <div class="avo-mob-grid">
              ${current.mobs.map((mob) => `
                <article class="avo-mob ${mob.locked ? 'locked' : ''}">
                  <img src="${mob.art}" alt="${mob.name}" loading="lazy" />
                  <div><strong>${mob.name}</strong><small>Lv ${mob.level} · ${mob.hp} HP</small></div>
                  <button data-fight="${mob.id}" ${mob.locked ? 'disabled title="Complete the prerequisite quest"' : ''}>${mob.locked ? 'Locked' : 'Fight'}</button>
                </article>`).join('')}
              <article class="avo-mob boss ${current.boss.defeated ? 'down' : ''} ${current.boss.locked ? 'locked' : ''}">
                <img src="${ANTAGONIST_ART[current.boss.id] ?? current.boss.art}" alt="${current.boss.name}" loading="lazy" />
                <div><strong>${current.boss.name}</strong><small>${current.boss.title ?? 'Boss'} · Lv ${current.boss.level}${current.boss.defeated ? ' · Defeated' : ''}</small></div>
                <button data-fight="${current.boss.id}" data-boss="1" ${current.boss.locked ? 'disabled title="Complete the prerequisite quest"' : ''}>${current.boss.locked ? 'Locked' : current.boss.defeated ? 'Challenge again' : 'Challenge'}</button>
              </article>
            </div>
          </div>
          <div class="avo-quests">
            <div class="avo-section-head"><h3>Quests</h3><span>${current.quests.filter((quest) => quest.state !== 'done').length} open</span></div>
            ${current.quests.map((quest) => {
              const classItem = quest.rewards.classItem ? state!.items[quest.rewards.classItem] : null;
              const stateLabel = quest.state === 'locked' ? 'Locked'
                : quest.state === 'available' ? 'Available'
                  : quest.state === 'active' ? 'Active'
                    : quest.state === 'ready' ? 'Ready to turn in' : 'Completed';
              return `
              <article class="avo-quest ${quest.state}">
                <div class="avo-quest-top">
                  <strong>${quest.name}</strong>
                  <span class="avo-quest-state ${quest.state}">${stateLabel}</span>
                </div>
                <small class="avo-quest-giver">${quest.npc}</small>
                <p>${quest.text}</p>
                <div class="avo-quest-objectives">
                  ${quest.objectives.map((objective) => `
                    <div class="avo-quest-objective ${objective.done ? 'done' : ''}">
                      <span>${objective.done ? '✓' : '○'} ${objective.label}</span>
                      <b>${objective.current} / ${objective.required}</b>
                    </div>`).join('')}
                </div>
                ${quest.completionText ? `<details class="avo-quest-dialog"><summary>Speak with ${quest.npc}</summary><p>${quest.completionText}</p></details>` : ''}
                ${Object.keys(quest.rewards.items).length || classItem ? `<div class="avo-quest-items">
                  ${Object.entries(quest.rewards.items).map(([id, count]) => {
                    const item = state!.items[id];
                    return `<span>${item ? `<img src="${item.icon}" alt="" />` : ''}${escapeHtml(item?.name ?? id.replace(/_/g, ' '))} ×${count}</span>`;
                  }).join('')}
                  ${classItem ? `<span><img src="${classItem.icon}" alt="" />${escapeHtml(classItem.name)} ×1</span>` : ''}
                </div>` : ''}
                <div class="avo-quest-bottom">
                  <small>+${quest.rewards.xp} XP · +${quest.rewards.sumo} SUMO</small>
                  ${quest.state === 'done'
                    ? '<span class="avo-done">Completed</span>'
                    : quest.state === 'locked'
                      ? `<span class="avo-quest-lock">${escapeHtml(quest.lockedReason ?? 'Locked')}</span>`
                      : quest.state === 'ready'
                        ? `<button data-turnin="${quest.id}">Turn in</button>`
                        : quest.state === 'active'
                          ? '<button disabled>In progress</button>'
                          : `<button data-accept="${quest.id}">Accept</button>`}
                </div>
              </article>`;
            }).join('')}
          </div>
        </div>
      </section>`;
  }

  function renderFarm(player: Player) {
    const farm = state!.farm;
    if (!farm) return '';
    return `
      <section class="avo-farm">
        <div class="avo-section-head">
          <div><p class="eyebrow">MEADOWFARM HOMESTEAD</p><h3>Three plots by the road</h3></div>
          <span>Harvest food and potions for the road. Crops grow in real time, even while you are away.</span>
        </div>
        <div class="avo-plots">
          ${farm.plots.map((plot) => `
            <div class="avo-plot ${plot.ready ? 'ready' : ''}">
              ${plot.crop
                ? `<img src="${plot.crop.icon}" alt="" /><strong>${plot.crop.name}</strong>
                   <small>${plot.ready ? 'Ready to harvest' : `Grows in ${formatMs(plot.remainingMs)}`}</small>
                   <button data-harvest="${plot.index}" ${plot.ready ? '' : 'disabled'}>${plot.ready ? 'Harvest' : 'Growing'}</button>`
                : `<span class="avo-plot-empty">Empty plot</span>
                   <div class="avo-plant-actions">${farm.crops.map((crop) => `<button data-plant="${plot.index}" data-crop="${crop.id}" title="${crop.name}">${crop.name}</button>`).join('')}</div>`}
            </div>`).join('')}
        </div>
        <small class="avo-muted">${player.name}, your plants keep growing while the game is closed.</small>
      </section>`;
  }

  function renderBattle(battle: Battle, player: Player) {
    const telegraph = battle.enemy.special
      ? `${battle.enemy.special.name}${battle.enemy.special.chance ? ` · ${Math.round(battle.enemy.special.chance * 100)}%` : ''}`
      : 'Basic attack';
    const lore = battle.kind === 'boss'
      ? state!.zones.find((entry) => entry.id === battle.zoneId)?.boss ?? null
      : null;
    const weapon = player.equipment.weapon;
    const consumables = state!.inventory.filter((item) => item.heal);
    return `
      <div class="avo-rt" role="dialog" aria-modal="true" aria-label="Battle">
        <canvas class="avo-stage" aria-label="Live combat"></canvas>
        <div class="avo-stage-vignette" aria-hidden="true"></div>

        <div class="avo-rt-top">
          <div class="avo-rt-enemy">
            ${battle.kind === 'boss' ? '<em class="avo-antagonist-tag">ANTAGONIST</em>' : ''}
            <div class="avo-rt-enemy-head">
              <h3>${escapeHtml(battle.enemy.name)}</h3>
              <small>Level ${battle.enemy.level} · ${escapeHtml(telegraph)}</small>
            </div>
            <div class="avo-rt-bar enemy"><i data-enemy-hp style="width:${battle.enemy.hp / battle.enemy.maxHp * 100}%"></i></div>
            <small class="avo-rt-num" data-enemy-text>${battle.enemy.hp} / ${battle.enemy.maxHp}</small>
            ${lore?.title ? `<p class="avo-rt-lore"><strong>${escapeHtml(lore.title)}</strong>${lore.taunt ? ` — “${escapeHtml(lore.taunt)}”` : ''}</p>` : ''}
          </div>
          <div class="avo-rt-clock" data-clock>0:00</div>
        </div>

        <div class="avo-rt-log" data-log aria-live="polite"></div>

        <div class="avo-rt-bottom">
          <div class="avo-rt-vitals">
            <div class="avo-rt-vitals-head">
              <strong>${escapeHtml(player.name)}</strong>
              <small>${escapeHtml(player.title)} · Lv ${player.level}</small>
            </div>
            <div class="avo-rt-bar hp"><i data-player-hp style="width:${battle.playerHp / player.maxHp * 100}%"></i></div>
            <small class="avo-rt-num" data-player-text>${battle.playerHp} / ${player.maxHp}</small>
            <div class="avo-rt-bar res"><i data-resource style="width:${player.resourceMax ? battle.playerResource / player.resourceMax * 100 : 0}%"></i></div>
            <small class="avo-rt-num" data-resource-text>${battle.playerResource} / ${player.resourceMax} ${player.resourceName}</small>
            ${weapon ? `<small class="avo-rt-armed"><img src="${weapon.icon}" alt="" />${escapeHtml(weapon.name)}</small>` : ''}
          </div>

          <div class="avo-rt-actions">
            <button class="avo-rt-main" data-rt-strike data-rt-action><strong>Strike</strong><kbd>Space</kbd></button>
            <button class="avo-rt-main dodge" data-rt-dodge data-rt-action><strong>Dodge</strong><kbd>Shift</kbd></button>
            ${player.abilities.map((ability, index) => `
              <button class="avo-rt-ability" data-rt-ability="${ability.id}" data-cost="${ability.cost}" title="${escapeHtml(ability.description)}">
                <img src="/woc/skills/${ABILITY_ICON[ability.id] ?? 'strike'}.webp" alt="" />
                <strong>${ability.name}</strong><small>${ability.cost > 0 ? ability.cost : 'Free'}</small>
                <kbd>${index + 1}</kbd>
              </button>`).join('')}
          </div>

          <div class="avo-rt-utility">
            ${consumables.map((item) => `
              <button data-rt-item="${item.id}" data-heal="${item.heal ?? 0}" data-rt-action title="${escapeHtml(item.description)}">
                <img src="${item.icon}" alt="" />${escapeHtml(item.name)} ×${item.count}
              </button>`).join('')}
            <button class="avo-flee" data-act="flee" data-rt-action>Flee</button>
          </div>

          <div class="avo-keys">
            <span><kbd>W A S D</kbd> move</span>
            <span><kbd>Space</kbd> strike</span>
            <span><kbd>Shift</kbd> dodge</span>
            <span><kbd>1-5</kbd> abilities</span>
            <span><kbd>F</kbd> flee</span>
          </div>
        </div>
      </div>`;
  }

  function renderResult(result: Result) {
    const itemCounts = new Map<string, number>();
    for (const [id, count] of Object.entries(result.items)) {
      itemCounts.set(id, (itemCounts.get(id) ?? 0) + count);
    }
    for (const id of result.loot) itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1);
    const itemRewards = [...itemCounts].map(([id, count]) => ({ id, count, item: state?.items[id] }));
    return `
      <div class="avo-result ${result.kind}">
        <p class="eyebrow">${result.kind === 'victory' ? 'VICTORY' : result.kind === 'defeat' ? 'DEFEAT' : result.kind === 'quest' ? 'QUEST COMPLETE' : result.kind === 'harvest' ? 'HARVEST' : 'RETREAT'}</p>
        <h3>${escapeHtml(result.title)}</h3>
        <p>${escapeHtml(result.message)}</p>
        <div class="avo-result-rewards">
          ${result.xp ? `<span>+${result.xp} XP</span>` : ''}
          ${result.sumo ? `<span>+${result.sumo} SUMO</span>` : ''}
          ${result.conquest ? `<span class="avo-conquest">ZONE CONQUERED · +${result.conquest} TRIBUTE</span>` : ''}
          ${result.levels ? `<span class="avo-level-up">LEVEL ${state?.player?.level ?? ''} REACHED</span>` : ''}
        </div>
        ${itemRewards.length ? `<div class="avo-loot-list" aria-label="Item rewards">${itemRewards.map((reward) => `
          <span class="avo-loot-chip">
            ${reward.item ? `<img src="${reward.item.icon}" alt="" />` : ''}
            <span>${escapeHtml(reward.item?.name ?? reward.id.replace(/_/g, ' '))}</span>
            <b>×${reward.count}</b>
          </span>`).join('')}</div>` : ''}
        <div class="avo-result-actions">
          <button data-act="rest" class="primary">Rest and continue</button>
          <button data-act="dismiss">Back to the zone</button>
        </div>
      </div>`;
  }

  function bindAdventure(player: Player, current: Zone | null) {
    container.querySelectorAll<HTMLButtonElement>('[data-zone]').forEach((button) => {
      button.addEventListener('click', () => {
        zoneId = button.dataset.zone!;
        showBag = false;
        audio.playClip('/woc/audio/ui_click.mp3', 0.3);
        render();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.act!;
        if (action === 'rest') {
          audio.playClip('/woc/audio/ui_click.mp3', 0.3);
          void act('/api/adventure/rest', {});
        } else if (action === 'bag') {
          showBag = !showBag;
          audio.playClip(`/woc/audio/${showBag ? 'ui_bag_open' : 'ui_bag_close'}.mp3`, 0.35);
          render();
        } else if (action === 'flee') {
          audio.playClip('/woc/audio/ui_weapon_sheathe.mp3', 0.4);
          void act('/api/adventure/battle/flee', {});
        } else if (action === 'dismiss') {
          state!.lastResult = null;
          audio.playClip('/woc/audio/ui_click.mp3', 0.3);
          render();
        }
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-accept]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/quest_accept_1.mp3', 0.45);
        void act('/api/adventure/quest/accept', { questId: button.dataset.accept });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-turnin]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/ui_quest_done.mp3', 0.5);
        void act('/api/adventure/quest/turnin', { questId: button.dataset.turnin });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-fight]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!current) return;
        audio.playClip('/woc/audio/ambush.mp3', 0.5);
        void act('/api/adventure/battle/start', { zoneId: current.id, mobId: button.dataset.fight });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-rt-strike]').forEach((button) => {
      button.addEventListener('click', () => battle3d?.strike());
    });
    container.querySelectorAll<HTMLButtonElement>('[data-rt-dodge]').forEach((button) => {
      button.addEventListener('click', () => battle3d?.dodge());
    });
    container.querySelectorAll<HTMLButtonElement>('[data-rt-ability]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.rtAbility;
        if (id) battle3d?.useAbility(id);
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-rt-item]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.rtItem;
        if (id) battle3d?.useItem(id, Number(button.dataset.heal ?? 0));
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/ui_weapon_unsheathe.mp3', 0.4);
        void act('/api/adventure/equip', { itemId: button.dataset.equip });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-unequip]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/ui_weapon_sheathe.mp3', 0.35);
        void act('/api/adventure/unequip', { slot: button.dataset.unequip });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-use]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/heal_impact.mp3', 0.35);
        void act('/api/adventure/item', { itemId: button.dataset.use });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-plant]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/ui_farm_plant.mp3', 0.45);
        void act('/api/adventure/farm/plant', {
          index: Number(button.dataset.plant), cropId: button.dataset.crop,
        });
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-harvest]').forEach((button) => {
      button.addEventListener('click', () => {
        audio.playClip('/woc/audio/ui_farm_harvest.mp3', 0.5);
        void act('/api/adventure/farm/harvest', { index: Number(button.dataset.harvest) });
      });
    });
  }

  function abilitySchool(id: string) {
    const map: Record<string, string> = {
      cinderbolt: 'fire', rimelance: 'frost', aether_insight: 'arcane', frost_nova: 'frost', arcane_barrier: 'arcane',
      smite: 'holy', greater_heal: 'holy', shadow_word_pain: 'shadow', power_word_shield: 'holy', renew: 'nature',
      serpent_sting: 'nature', field_dressing: 'nature', holy_light: 'holy', judgment: 'holy', divine_shield: 'holy',
      consecration: 'holy', stealth: 'shadow', recuperate: 'nature', onrush: 'physical',
      wrath: 'nature', moonfire: 'arcane', rejuvenation: 'nature', barkskin: 'nature', starfire: 'arcane',
      lightning_bolt: 'nature', flame_shock: 'fire', healing_wave: 'nature', frost_shock: 'frost', storm_totem: 'nature',
      shadow_bolt: 'shadow', corruption: 'shadow', drain_life: 'shadow', howl_of_terror: 'shadow', soul_fire: 'fire',
    };
    return map[id] ?? 'physical';
  }

  function playResultSounds() {
    const result = state?.lastResult;
    if (result?.kind === 'victory') {
      const clip = result.levels > 0
        ? 'ui_level_up'
        : result.loot.length > 0
          ? 'ui_loot_item_1'
          : 'ui_achievement';
      audio.playClip(`/woc/audio/${clip}.mp3`, 0.55);
    } else if (result?.kind === 'defeat') {
      audio.playClip('/woc/audio/ui_death.mp3', 0.55);
    }
  }

  function syncMusic(battle: Battle | null) {
    if (!active) return;
    if (battle) {
      const boss = BOSS_MUSIC[battle.zoneId] ?? 'boss_korgath_the_bound';
      const combatTrack = battle.id.charCodeAt(0) % 2 + 1;
      audio.playMusic(battle.kind === 'boss' ? `/woc/audio/${boss}.mp3` : `/woc/audio/combat_${combatTrack}.mp3`);
      return;
    }
    const current = zone();
    audio.playMusic(current?.music ? `/woc/audio/${current.music}.mp3` : '/woc/audio/town_eastbrook.mp3');
  }

  function scheduleFarmTick() {
    if (ticker !== null) window.clearInterval(ticker);
    ticker = null;
    const farm = state?.farm;
    if (!farm) return;
    const growing = farm.plots.some((plot) => plot.crop && !plot.ready);
    if (!growing) return;
    ticker = window.setInterval(() => {
      if (!active || !state?.farm) return;
      if (battle3d) return;
      let becameReady = false;
      state.farm.plots = state.farm.plots.map((plot) => {
        if (!plot.crop) return plot;
        const remainingMs = Math.max(0, plot.remainingMs - 1000);
        const ready = remainingMs === 0;
        if (ready && !plot.ready) becameReady = true;
        return { ...plot, remainingMs, ready };
      });
      if (becameReady) audio.playClip('/woc/audio/ui_farm_ready.mp3', 0.45);
      if (!state.farm.plots.some((plot) => plot.crop && !plot.ready)) {
        if (ticker !== null) window.clearInterval(ticker);
        ticker = null;
      }
      render();
    }, 1000);
  }

  void refresh();
  document.addEventListener('keydown', onKey);
  return () => {
    active = false;
    document.removeEventListener('keydown', onKey);
    if (ticker !== null) window.clearInterval(ticker);
    disposeBattle3D();
    ticker = null;
    audio.playMusic(null);
  };
}

function statText(item: Item) {
  const parts: string[] = [];
  if (item.stats?.attack) parts.push(`+${item.stats.attack} attack`);
  if (item.stats?.spell) parts.push(`+${item.stats.spell} spell`);
  if (item.stats?.armor) parts.push(`+${item.stats.armor} armor`);
  if (item.stats?.hp) parts.push(`+${item.stats.hp} health`);
  if (item.stats?.crit) parts.push(`+${item.stats.crit}% crit`);
  return parts.join(' · ') || item.description;
}

function formatMs(ms: number) {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char] ?? char));
}
