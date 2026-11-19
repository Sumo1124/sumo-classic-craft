import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { armorReduction, mobArmorReduction, rollDamage, spellHitChance, swingMissChance } from './combat-rules';

export type WeaponKind = 'sword' | 'axe' | 'club' | 'staff' | 'claw';

export type FighterLook = {
  body: number;
  trim: number;
  skin: number;
  metal: number;
  scale: number;
  weapon: WeaponKind;
  hooded: boolean;
};

export type AbilityInfo = {
  id: string;
  name: string;
  cost: number;
  cooldown: number;
  type: string;
  school: string;
};

export type HudSnapshot = {
  playerHp: number;
  playerMaxHp: number;
  resource: number;
  resourceMax: number;
  enemyHp: number;
  enemyMaxHp: number;
  cooldowns: Record<string, number>;
  log: string[];
  phase: 'fight' | 'won' | 'lost';
  elapsedMs: number;
};

export type EndReport = {
  win: boolean;
  playerHp: number;
  resource: number;
  hits: number;
  durationMs: number;
  items: string[];
};

export type BattleConfig = {
  hero: FighterLook;
  enemy: FighterLook;
  enemyName: string;
  playerName: string;
  heroModel: string | null;
  heroModelHeight?: number;
  enemyModel: string | null;
  enemyModelHeight?: number;
  zoneId?: string;
  studentName?: string;
  playerHp: number;
  playerMaxHp: number;
  resource: number;
  resourceMax: number;
  playerAttack: number;
  playerCrit: number;
  playerArmor: number;
  playerLevel: number;
  enemyHp: number;
  enemyMaxHp: number;
  enemyMin: number;
  enemyMax: number;
  enemyArmor: number;
  enemyLevel: number;
  abilities: AbilityInfo[];
  onHud: (hud: HudSnapshot) => void;
  onEnd: (report: EndReport) => void;
  audio: { playClip: (src: string, volume?: number) => void };
};

export type BattleHandle = {
  dispose: () => void;
  strike: () => void;
  dodge: () => void;
  useAbility: (id: string) => void;
  useItem: (itemId: string, heal: number) => void;
};

type Arm = { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group };
type Leg = { hip: THREE.Group; knee: THREE.Group };
type Rig = {
  root: THREE.Group;
  body: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: Arm;
  armR: Arm;
  legL: Leg;
  legR: Leg;
  weapon: THREE.Object3D;
  mats: THREE.MeshStandardMaterial[];
  height: number;
};

type AnimKind = 'idle' | 'run' | 'attack' | 'hit' | 'death' | 'cast' | 'dodge' | 'windup';

type Avatar = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clips: Record<AnimKind, string | null>;
  current: string;
};

type Fighter = {
  rig: Rig;
  pos: THREE.Vector3;
  hp: number;
  maxHp: number;
  anim: AnimKind;
  animT: number;
  animDur: number;
  phase: number;
  cooldown: number;
  flash: number;
  dead: boolean;
  struck: boolean;
  avatar: Avatar | null;
  collisionRadius: number;
};

type Particle = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
};

const HERO_POS = new THREE.Vector3(-3.1, 0, 0.2);
const ENEMY_POS = new THREE.Vector3(3.1, 0, -0.1);
const ARENA_RADIUS = 7.4;
const PLAYER_SPEED = 4.3;
const ENEMY_SPEED = 3.5;
const PLAYER_REACH = 2.35;
const ENEMY_REACH = 2.35;
const ENEMY_STOP = 1.9;
const ATTACK_TIME = 0.62;
const STRIKE_AT = 0.36;
// ClaudeCraft's KayKit/Quaternius models export with +Z as their forward axis.
const MODEL_FACING = 0;

type ClipSet = {
  idle: string[];
  run: string[];
  attack: string[];
  cast: string[];
  hit: string[];
  death: string[];
  dodge: string[];
};

const HUMANOID_CLIPS: ClipSet = {
  idle: ['Idle'],
  run: ['Running_A', 'Run', 'Walk'],
  attack: [
    '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal',
    'Attack', 'Attack2', 'StaffStrike', 'ScytheSweep', 'HammerSlam', 'MaulArc', 'Claw', 'Bite',
    'Snap', 'Balgath_Clobber', 'Balgath_Smash', 'Punch',
  ],
  cast: [
    'Spellcast_Shoot', 'Spellcast_Raise', 'Spellcasting', 'Cast', 'Raise',
    'SummonSouls', 'BellToll', 'BreathGround', 'GraveInferno', 'Brine_Spit', 'Tide_Breath', 'Roar', 'Balgath_Roar',
  ],
  hit: ['Hit_A', 'HitRecieve', 'Hit', 'React'],
  death: ['Death_A', 'Death'],
  dodge: ['Running_Strafe_Left', 'Running_Strafe_Right', 'Walking_Backwards', 'Run'],
};

const BEAST_CLIPS: ClipSet = {
  idle: ['Idle', 'Idle_2', 'Idle1', 'Idle_AnimalArmature', 'Flying_Idle'],
  run: ['Gallop', 'Gallop_AnimalArmature', 'Run', 'Walk', 'Walk_AnimalArmature', 'Fast_Flying'],
  attack: ['Attack', 'Bite_Front_MonsterArmature', 'Bite_Front', 'Attack1 (marracca)', 'Attack2 (tusks)', 'Attack_Headbutt_AnimalArmature', 'Punch'],
  cast: ['Attack', 'Bite_Front', 'Headbutt'],
  hit: ['Hurt', 'HitRecieve', 'Idle_HitReact_Left', 'Idle_HitReact_Right', 'Idle_HitReact_Left_AnimalArmature', 'HitReact'],
  death: ['Death', 'Death_AnimalArmature', 'Dying'],
  dodge: ['Gallop', 'Jump', 'Spider_Jump', 'Move2 (shuffle)'],
};

const BEAST_MODEL = /wolf|boar|spider|greyjaw|glubevolved|ghost|orc|yeti/i;

type ZoneScene = {
  sky: string | null;
  hdr: string;
  fog: [number, number, number];
  hemi: [number, number, number];
  sun: [number, number];
  rim: [number, number];
  envIntensity: number;
  exposure: number;
  ground: {
    map: string; normal: string; rough: string | null; emissive: string | null;
    tint: number; repeat: number; glow: number;
  };
  motes: { color: number; count: number; size: number; rise: number; additive: boolean; opacity: number };
};

const TERRAIN = '/woc/cc/terrain';
const ZONE_SCENES: Record<string, ZoneScene> = {
  'eastbrook-vale': {
    sky: '/woc/cc/env/vale_backdrop.webp',
    hdr: '/woc/cc/env/vale_day_1k.hdr',
    fog: [0xc9dce4, 34, 96],
    hemi: [0xdcecff, 0x6d7a45, 1.15],
    sun: [0xfff1cd, 3.1],
    rim: [0xbdd8ff, 0.7],
    envIntensity: 0.65,
    exposure: 1.02,
    ground: { map: `${TERRAIN}/Grass001_Color.jpg`, normal: `${TERRAIN}/Grass001_NormalGL.jpg`, rough: `${TERRAIN}/Grass001_Roughness.jpg`, emissive: null, tint: 0xd6e6b4, repeat: 22, glow: 0 },
    motes: { color: 0xfff2c8, count: 130, size: 0.05, rise: 0.06, additive: true, opacity: 0.55 },
  },
  'mirefen-marsh': {
    sky: '/woc/cc/env/marsh_backdrop.webp',
    hdr: '/woc/cc/env/marsh_overcast_1k.hdr',
    fog: [0x93a48e, 16, 58],
    hemi: [0xc4d4c0, 0x3d4a38, 0.95],
    sun: [0xe6ecd8, 1.9],
    rim: [0x9fb6c8, 0.5],
    envIntensity: 0.5,
    exposure: 0.96,
    ground: { map: `${TERRAIN}/Ground023_Color.jpg`, normal: `${TERRAIN}/Ground023_NormalGL.jpg`, rough: `${TERRAIN}/Ground023_Roughness.jpg`, emissive: null, tint: 0xa8b894, repeat: 16, glow: 0 },
    motes: { color: 0xc8e89a, count: 150, size: 0.055, rise: 0.12, additive: true, opacity: 0.5 },
  },
  'thornpeak-heights': {
    sky: '/woc/cc/env/peaks_backdrop.webp',
    hdr: '/woc/cc/env/peaks_dawn_1k.hdr',
    fog: [0xcfd9e8, 24, 82],
    hemi: [0xe4ecff, 0x8a94a8, 1.1],
    sun: [0xffe6c4, 2.6],
    rim: [0xa9c4ff, 0.8],
    envIntensity: 0.6,
    exposure: 1.0,
    ground: { map: `${TERRAIN}/Snow001_Color.jpg`, normal: `${TERRAIN}/Snow001_NormalGL.jpg`, rough: `${TERRAIN}/Snow001_Roughness.jpg`, emissive: null, tint: 0xf4f8ff, repeat: 18, glow: 0 },
    motes: { color: 0xffffff, count: 320, size: 0.07, rise: -0.55, additive: false, opacity: 0.85 },
  },
  drakelands: {
    sky: null,
    hdr: '/woc/cc/env/ember_storm_1k.hdr',
    fog: [0x2a1a18, 20, 72],
    hemi: [0xb89b88, 0x261915, 1.05],
    sun: [0xffc58f, 2.35],
    rim: [0xff7545, 1.0],
    envIntensity: 0.6,
    exposure: 1.08,
    ground: { map: `${TERRAIN}/Lava004_Color.jpg`, normal: `${TERRAIN}/Lava004_NormalGL.jpg`, rough: null, emissive: `${TERRAIN}/Lava004_Emission.jpg`, tint: 0x9c8c80, repeat: 22, glow: 0.28 },
    motes: { color: 0xffa244, count: 190, size: 0.06, rise: 0.55, additive: true, opacity: 0.8 },
  },
  willowfen: {
    sky: null,
    hdr: '/woc/cc/env/wraithwood_gloom_1k.hdr',
    fog: [0x14201e, 15, 56],
    hemi: [0x9fc4b8, 0x14201a, 0.75],
    sun: [0xbfe0d0, 1.2],
    rim: [0x6fd0c0, 0.7],
    envIntensity: 0.4,
    exposure: 0.95,
    ground: { map: `${TERRAIN}/Ground080_Color.jpg`, normal: `${TERRAIN}/Ground080_NormalGL.jpg`, rough: `${TERRAIN}/Ground080_Roughness.jpg`, emissive: null, tint: 0x92ac90, repeat: 16, glow: 0 },
    motes: { color: 0x8fe6d8, count: 160, size: 0.06, rise: 0.18, additive: true, opacity: 0.65 },
  },
};

function clipName(names: string[], candidates: string[]): string | null {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const candidate of candidates) {
    const exact = names.find((name) => name === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    const match = names.find((name) => norm(name) === wanted);
    if (match) return match;
  }
  for (const candidate of candidates) {
    const wanted = norm(candidate);
    const match = names.find((name) => norm(name).includes(wanted));
    if (match) return match;
  }
  return null;
}

function easeOut(t: number) {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t: number) {
  return t * t;
}
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function box(w: number, h: number, d: number, mat: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function limb(radius: number, length: number, mat: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat);
  mesh.position.y = -length / 2;
  return mesh;
}

function buildWeapon(kind: WeaponKind, metal: THREE.MeshStandardMaterial, wood: THREE.MeshStandardMaterial) {
  const group = new THREE.Group();
  if (kind === 'sword') {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 8), wood);
    grip.position.y = -0.1;
    const guard = box(0.3, 0.045, 0.07, metal);
    guard.position.y = -0.21;
    const blade = box(0.09, 0.86, 0.026, metal);
    blade.position.y = -0.66;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.15, 4), metal);
    point.position.y = -1.16;
    point.rotation.y = Math.PI / 4;
    group.add(grip, guard, blade, point);
  } else if (kind === 'axe') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.03, 1.0, 8), wood);
    haft.position.y = -0.5;
    const head = box(0.4, 0.34, 0.07, metal);
    head.position.set(0.18, -0.88, 0);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 4), metal);
    spike.position.set(-0.14, -0.88, 0);
    spike.rotation.z = Math.PI / 2;
    group.add(haft, head, spike);
  } else if (kind === 'club') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 1.05, 8), wood);
    haft.position.y = -0.52;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.34, 8), metal);
    head.position.y = -0.95;
    group.add(haft, head);
  } else if (kind === 'staff') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), wood);
    haft.position.y = -0.45;
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), metal);
    orb.position.y = 0.36;
    group.add(haft, orb);
  } else {
    for (let index = 0; index < 3; index += 1) {
      const talon = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.42, 4), metal);
      talon.position.set((index - 1) * 0.08, -0.24, 0.02);
      talon.rotation.z = (index - 1) * 0.28;
      group.add(talon);
    }
  }
  return group;
}

function buildRig(look: FighterLook): Rig {
  const materials: THREE.MeshStandardMaterial[] = [];
  const make = (color: number, roughness: number, metalness: number) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.push(material);
    return material;
  };
  const bodyMat = make(look.body, 0.76, 0.12);
  const trimMat = make(look.trim, 0.5, 0.4);
  const skinMat = make(look.skin, 0.88, 0);
  const metalMat = make(look.metal, 0.28, 0.5);
  const woodMat = make(0x4b3524, 0.9, 0.02);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.94;
  body.add(hips);

  const pelvis = box(0.42, 0.22, 0.3, bodyMat);
  hips.add(pelvis);

  const torso = new THREE.Group();
  hips.add(torso);

  const chest = box(0.54, 0.5, 0.34, bodyMat);
  chest.position.y = 0.36;
  torso.add(chest);

  const collar = box(0.58, 0.12, 0.36, trimMat);
  collar.position.y = 0.58;
  torso.add(collar);

  const beltFlash = box(0.46, 0.08, 0.32, trimMat);
  beltFlash.position.y = 0.1;
  torso.add(beltFlash);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.13, 8), skinMat);
  neck.position.y = 0.64;
  torso.add(neck);

  const head = new THREE.Group();
  head.position.y = 0.8;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skinMat);
  skull.scale.set(1, 1.08, 0.94);
  head.add(skull);
  if (look.hooded) {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), bodyMat);
    hood.position.y = 0.03;
    head.add(hood);
    const shade = new THREE.Mesh(
      new THREE.CircleGeometry(0.115, 16),
      new THREE.MeshBasicMaterial({ color: 0x090d0b }),
    );
    shade.position.set(0, 0.005, 0.142);
    head.add(shade);
    const ember = new THREE.MeshBasicMaterial({ color: 0xffd679 });
    [-0.045, 0.045].forEach((offset) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.019, 7, 6), ember);
      eye.position.set(offset, 0.02, 0.17);
      head.add(eye);
    });
  } else {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), metalMat);
    helmet.position.y = 0.02;
    helmet.scale.set(1, 1, 1.02);
    head.add(helmet);
    const brow = box(0.34, 0.045, 0.06, trimMat);
    brow.position.set(0, 0.03, 0.145);
    head.add(brow);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x11181d });
    [-0.058, 0.058].forEach((offset) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.021, 7, 6), eyeMat);
      eye.position.set(offset, -0.012, 0.158);
      head.add(eye);
    });
  }

  const emblem = box(0.15, 0.17, 0.03, trimMat);
  emblem.position.set(0, 0.4, 0.175);
  torso.add(emblem);

  const shoulderPad = (side: number) => {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), trimMat);
    pad.position.set(side * 0.31, 0.63, 0);
    pad.rotation.z = side * -0.22;
    torso.add(pad);
  };
  shoulderPad(1);
  shoulderPad(-1);

  const buildArm = (side: number): Arm => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.32, 0.55, 0);
    torso.add(shoulder);
    shoulder.add(limb(0.078, 0.34, bodyMat));
    const elbow = new THREE.Group();
    elbow.position.y = -0.36;
    shoulder.add(elbow);
    elbow.add(limb(0.066, 0.32, skinMat));
    const hand = new THREE.Group();
    hand.position.y = -0.34;
    elbow.add(hand);
    const palm = box(0.115, 0.15, 0.11, skinMat);
    hand.add(palm);
    return { shoulder, elbow, hand };
  };

  const buildLeg = (side: number): Leg => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.15, -0.02, 0);
    hips.add(hip);
    hip.add(limb(0.098, 0.42, bodyMat));
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    hip.add(knee);
    knee.add(limb(0.082, 0.4, bodyMat));
    const foot = box(0.17, 0.11, 0.3, trimMat);
    foot.position.set(0, -0.44, 0.08);
    knee.add(foot);
    return { hip, knee };
  };

  const armL = buildArm(-1);
  const armR = buildArm(1);
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  const weapon = buildWeapon(look.weapon, metalMat, woodMat);
  armR.hand.add(weapon);

  root.scale.setScalar(look.scale);

  return { root, body, hips, torso, head, armL, armR, legL, legR, weapon, mats: materials, height: 1.9 * look.scale };
}

function resetPose(rig: Rig) {
  rig.body.rotation.set(0, 0, 0);
  rig.body.position.set(0, 0, 0);
  rig.hips.position.set(0, 0.94, 0);
  rig.hips.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.torso.position.set(0, 0, 0);
  rig.head.rotation.set(0, 0, 0);
  rig.armL.shoulder.rotation.set(0.05, 0, 0.14);
  rig.armL.elbow.rotation.set(-0.22, 0, 0);
  rig.armR.shoulder.rotation.set(0.05, 0, -0.14);
  rig.armR.elbow.rotation.set(-0.22, 0, 0);
  rig.legL.hip.rotation.set(0, 0, 0);
  rig.legL.knee.rotation.set(0, 0, 0);
  rig.legR.hip.rotation.set(0, 0, 0);
  rig.legR.knee.rotation.set(0, 0, 0);
  rig.weapon.rotation.set(-1.45, 0, 0);
}

function poseFighter(fighter: Fighter, time: number) {
  const rig = fighter.rig;
  resetPose(rig);
  const t = fighter.animT;
  const k = fighter.animDur > 0 ? clamp(t / fighter.animDur, 0, 1) : 0;

  if (fighter.anim === 'death') {
    const fall = easeOut(clamp(t / 0.9, 0, 1));
    rig.body.rotation.x = -1.5 * fall;
    rig.body.position.y = -0.12 * fall;
    rig.armL.shoulder.rotation.set(0.5, 0, 0.9);
    rig.armR.shoulder.rotation.set(0.4, 0, -0.8);
    return;
  }

  if (fighter.anim === 'run') {
    const swing = Math.sin(fighter.phase);
    rig.legL.hip.rotation.x = swing * 0.8;
    rig.legR.hip.rotation.x = -swing * 0.8;
    rig.legL.knee.rotation.x = Math.max(0, -swing) * 1.05;
    rig.legR.knee.rotation.x = Math.max(0, swing) * 1.05;
    rig.armL.shoulder.rotation.x = -swing * 0.62;
    rig.armR.shoulder.rotation.x = swing * 0.62;
    rig.armL.elbow.rotation.x = -0.55;
    rig.armR.elbow.rotation.x = -0.55;
    rig.torso.rotation.x = 0.14;
    rig.hips.position.y = 0.94 + Math.abs(swing) * 0.045;
    rig.torso.rotation.y = swing * 0.08;
    return;
  }

  if (fighter.anim === 'attack') {
    let shoulder: number;
    let twist: number;
    if (k < 0.45) {
      const u = easeOut(k / 0.45);
      shoulder = lerp(0.05, 1.0, u);
      twist = lerp(0, -0.42, u);
    } else if (k < 0.63) {
      const u = easeIn((k - 0.45) / 0.18);
      shoulder = lerp(1.0, -1.45, u);
      twist = lerp(-0.42, 0.55, u);
    } else {
      const u = easeOut((k - 0.63) / 0.37);
      shoulder = lerp(-1.45, 0.05, u);
      twist = lerp(0.55, 0, u);
    }
    rig.weapon.rotation.x = 0;
    rig.armR.shoulder.rotation.x = shoulder;
    rig.armR.shoulder.rotation.z = -0.28;
    rig.armR.elbow.rotation.x = k < 0.63 ? -0.85 : -0.3;
    rig.armL.shoulder.rotation.x = -0.45;
    rig.armL.elbow.rotation.x = -0.9;
    rig.torso.rotation.y = twist;
    rig.hips.rotation.y = twist * 0.35;
    rig.torso.rotation.x = k < 0.45 ? -0.12 : 0.2;
    rig.legL.hip.rotation.x = -0.18;
    rig.legR.hip.rotation.x = 0.24;
    rig.legR.knee.rotation.x = 0.2;
    return;
  }

  if (fighter.anim === 'cast') {
    const lift = k < 0.5 ? easeOut(k / 0.5) : 1 - easeOut((k - 0.5) / 0.5) * 0.6;
    rig.armR.shoulder.rotation.x = -1.5 * lift;
    rig.armR.elbow.rotation.x = -0.4;
    rig.armL.shoulder.rotation.x = -1.4 * lift;
    rig.armL.elbow.rotation.x = -0.5;
    rig.torso.rotation.x = -0.12 * lift;
    rig.head.rotation.x = -0.16 * lift;
    return;
  }

  if (fighter.anim === 'hit') {
    const jolt = k < 0.35 ? easeOut(k / 0.35) : 1 - (k - 0.35) / 0.65;
    rig.torso.rotation.x = -0.34 * jolt;
    rig.head.rotation.x = -0.3 * jolt;
    applyRigLean(rig, jolt);
    rig.armL.shoulder.rotation.x = -0.5 * jolt;
    rig.armR.shoulder.rotation.x = 0.4 * jolt;
    return;
  }

  if (fighter.anim === 'dodge') {
    rig.torso.rotation.x = 0.7;
    rig.hips.position.y = 0.75;
    rig.legL.hip.rotation.x = 0.9;
    rig.legL.knee.rotation.x = 1.3;
    rig.legR.hip.rotation.x = -0.5;
    rig.legR.knee.rotation.x = 1.1;
    rig.armL.shoulder.rotation.x = 0.7;
    rig.armR.shoulder.rotation.x = 0.7;
    return;
  }

  if (fighter.anim === 'windup') {
    rig.weapon.rotation.x = -0.7;
    rig.armR.shoulder.rotation.x = 1.15;
    rig.armR.shoulder.rotation.z = -0.3;
    rig.armR.elbow.rotation.x = -0.95;
    rig.armL.shoulder.rotation.x = -0.4;
    rig.armL.elbow.rotation.x = -0.85;
    rig.torso.rotation.y = -0.34;
    rig.hips.rotation.y = -0.14;
    rig.torso.rotation.x = -0.12;
    rig.legR.knee.rotation.x = 0.26;
    rig.legL.hip.rotation.x = -0.12;
    return;
  }

  const breathe = Math.sin(time * 1.8) * 0.5 + 0.5;
  rig.torso.rotation.x = 0.02 + breathe * 0.02;
  rig.head.rotation.y = Math.sin(time * 0.7) * 0.06;
  rig.armL.shoulder.rotation.x = 0.05 + breathe * 0.03;
  rig.armR.shoulder.rotation.x = 0.05 + breathe * 0.03;
  rig.hips.position.y = 0.94 + breathe * 0.012;
}

function applyRigLean(rig: Rig, amount: number) {
  rig.hips.position.z = -0.07 * amount;
  rig.hips.rotation.x = -0.08 * amount;
}

function makeTextSprite(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 78px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(8,10,8,0.85)';
    ctx.strokeText(text, 128, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.66, 0.33, 1);
  return sprite;
}

function makeMoteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,0.22)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

export function startBattle3D(canvas: HTMLCanvasElement, config: BattleConfig): BattleHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let disposed = false;
  let assetsReady = false;
  let loading: HTMLDivElement | null = null;
  const loadingManager = new THREE.LoadingManager();
  loadingManager.onLoad = () => {
    if (disposed || assetsReady) return;
    assetsReady = true;
    loading?.classList.add('ready');
    window.setTimeout(() => loading?.remove(), 450);
  };

  // ClaudeCraft's GLBs are meshopt-compressed and use KTX2 (Basis) textures.
  const gltfLoader = new GLTFLoader(loadingManager);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  const ktx2 = new KTX2Loader(loadingManager).setTranscoderPath('/basis/').detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2);

  // Each zone reuses ClaudeCraft's own sky, HDR lighting and PBR terrain set.
  const zoneId = config.zoneId ?? 'eastbrook-vale';
  const zone = ZONE_SCENES[zoneId] ?? ZONE_SCENES['eastbrook-vale'];
  renderer.toneMappingExposure = zone.exposure;

  const host = canvas.parentElement;
  if (host) {
    loading = document.createElement('div');
    loading.className = 'avo-loading';
    loading.setAttribute('role', 'status');
    loading.innerHTML = '<span class="avo-loading-ring" aria-hidden="true"></span><strong>Preparing the battlefield</strong><small>Loading combatants, terrain, and atmosphere…</small>';
    host.append(loading);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(zone.fog[0]);
  scene.fog = new THREE.Fog(zone.fog[0], zone.fog[1], zone.fog[2]);

  const texLoader = new THREE.TextureLoader(loadingManager);
  const hdrLoader = new HDRLoader(loadingManager);
  if (zone.sky) {
    texLoader.load(zone.sky, (texture) => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.backgroundBlurriness = 0.06;
    });
  }
  hdrLoader.load(zone.hdr, (texture) => {
    if (disposed) { texture.dispose(); return; }
    scene.environment = texture;
    scene.environmentIntensity = zone.envIntensity;
    if (!zone.sky) scene.background = texture;
  });

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 160);
  const enemyHeight = config.enemyModelHeight ?? 1.9;
  const subjectHeight = Math.max(config.heroModelHeight ?? 1.88, enemyHeight);
  const framing = clamp(subjectHeight / 2.35, 1, 1.32);
  const baseHeight = 2.45 * framing;
  const baseDistance = 6.7 * framing;
  const defaultLookY = Math.max(1.05, subjectHeight * 0.42);
  const baseCamera = new THREE.Vector3(0, baseHeight, baseDistance);
  const lookTarget = new THREE.Vector3(0, defaultLookY, 0);
  const baseEnemyStop = ENEMY_STOP + Math.max(0, enemyHeight - 2.2) * 0.45;
  camera.position.copy(baseCamera);
  camera.lookAt(lookTarget);

  const hemi = new THREE.HemisphereLight(zone.hemi[0], zone.hemi[1], zone.hemi[2]);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(zone.sun[0], zone.sun[1]);
  key.position.set(-7, 12, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 46;
  key.shadow.camera.left = -14;
  key.shadow.camera.right = 14;
  key.shadow.camera.top = 14;
  key.shadow.camera.bottom = -14;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(zone.rim[0], zone.rim[1]);
  rim.position.set(6, 7, -7);
  scene.add(rim);

  const groundTextures: THREE.Texture[] = [];
  const groundMap = (url: string, srgb: boolean) => {
    const texture = texLoader.load(url);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(zone.ground.repeat, zone.ground.repeat);
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    groundTextures.push(texture);
    return texture;
  };
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundMap(zone.ground.map, true),
    normalMap: groundMap(zone.ground.normal, false),
    color: zone.ground.tint,
    roughness: 1,
    metalness: 0,
  });
  if (zone.ground.rough) groundMat.roughnessMap = groundMap(zone.ground.rough, false);
  if (zone.ground.emissive) {
    groundMat.emissiveMap = groundMap(zone.ground.emissive, true);
    groundMat.emissive = new THREE.Color(0xffffff);
    groundMat.emissiveIntensity = zone.ground.glow;
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 72), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function placeProp(url: string, x: number, z: number, height: number, rotation = 0) {
    gltfLoader.load(url, (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const scale = height / Math.max(0.01, size.y);
      root.scale.setScalar(scale);
      root.position.set(x, -bounds.min.y * scale, z);
      root.rotation.y = rotation;
      root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;
      });
      scene.add(root);
    });
  }

  const trees: [number, number, number, number][] = [
    [-13, -6.5, 9.5, 0.4], [13.5, -5.5, 8.8, -0.3], [-21, -11, 11, 0.9],
    [21, -15, 10, 0.2], [-9.5, -19, 12, 0.7], [9.5, -21, 11, -0.6],
    [-27, -2, 10, 0.1], [27, -7, 9.5, 0.8],
  ];
  const plantTrees = (list: [number, number, number, number][], heightScale = 1) => {
    list.forEach(([x, z, height, rotation], index) => {
      placeProp(`/woc/cc/props/${index % 2 === 0 ? 'oak_1' : 'oak_2'}.glb`, x, z, height * heightScale, rotation);
    });
  };

  let scatterSeed = 1337;
  const scatterRand = () => {
    scatterSeed = (scatterSeed * 1664525 + 1013904223) % 4294967296;
    return scatterSeed / 4294967296;
  };
  const scatter = (url: string, count: number, minRadius: number, maxRadius: number, height: number) => {
    for (let index = 0; index < count; index += 1) {
      const angle = scatterRand() * Math.PI * 2;
      const radius = minRadius + scatterRand() * (maxRadius - minRadius);
      const x = Math.cos(angle) * radius;
      const z = -3 - Math.abs(Math.sin(angle) * radius);
      placeProp(url, x, z, height * (0.8 + scatterRand() * 0.5), scatterRand() * Math.PI * 2);
    }
  };

  if (zoneId === 'mirefen-marsh') {
    plantTrees(trees.slice(0, 5), 0.85);
    scatter('/woc/cc/props/fern.glb', 20, 7, 18, 0.95);
    scatter('/woc/cc/props/bush.glb', 10, 8, 20, 1.0);
    scatter('/woc/cc/props/rock_1.glb', 8, 8, 22, 1.2);
  } else if (zoneId === 'thornpeak-heights') {
    plantTrees(trees.slice(0, 3), 0.75);
    scatter('/woc/cc/props/rock_1.glb', 12, 8, 22, 1.6);
    scatter('/woc/cc/props/desert_rock_formation_1.glb', 4, 12, 24, 5.5);
    scatter('/woc/cc/props/cave_rocks_a.glb', 5, 9, 20, 2.2);
  } else if (zoneId === 'drakelands') {
    scatter('/woc/cc/props/desert_tree.glb', 7, 9, 22, 4.8);
    scatter('/woc/cc/props/cave_rocks_a.glb', 8, 8, 22, 2.2);
    scatter('/woc/cc/props/cave_rocks_b.glb', 6, 9, 24, 1.9);
    scatter('/woc/cc/props/desert_rock_formation_1.glb', 2, 18, 28, 4.2);
  } else if (zoneId === 'willowfen') {
    plantTrees(trees, 1.15);
    plantTrees(trees.slice(0, 4).map(([x, z, height, rotation]): [number, number, number, number] => [x * 0.8, z - 7, height, rotation + 1]), 1.0);
    scatter('/woc/cc/props/fern.glb', 14, 7, 18, 0.85);
    scatter('/woc/cc/props/bush.glb', 10, 8, 20, 1.2);
    scatter('/woc/cc/props/rock_1.glb', 6, 8, 22, 1.2);
  } else {
    placeProp('/woc/cc/props/eastbrook_chapel.glb', -17, -24, 11, 0.55);
    placeProp('/woc/cc/props/house_2.glb', 17, -20, 6.2, -0.7);
    placeProp('/woc/cc/props/house_3.glb', 24, -11, 5.4, -1.15);
    placeProp('/woc/cc/props/well.glb', -7.6, -10.5, 2.4, 0.3);
    placeProp('/woc/cc/props/cart.glb', 8.4, -9.6, 1.9, 0.5);
    placeProp('/woc/cc/props/fence.glb', -2.6, -13.4, 1.35, 0);
    placeProp('/woc/cc/props/fence.glb', 1.2, -13.6, 1.35, 0);
    plantTrees(trees);
    scatter('/woc/cc/props/bush.glb', 12, 8, 20, 1.1);
    scatter('/woc/cc/props/fern.glb', 14, 7.5, 18, 0.75);
    scatter('/woc/cc/props/rock_1.glb', 7, 8, 22, 1.3);
  }

  // Ambient motes: pollen in the Vale, spores in the marsh, snow on the peaks,
  // embers in the Drakelands and wisps in Willowfen.
  const moteCount = zone.motes.count;
  const motePositions = new Float32Array(moteCount * 3);
  const moteSeeds = new Float32Array(moteCount);
  for (let index = 0; index < moteCount; index += 1) {
    motePositions[index * 3] = (Math.random() - 0.5) * 30;
    motePositions[index * 3 + 1] = Math.random() * 7;
    motePositions[index * 3 + 2] = (Math.random() - 0.5) * 26 - 2;
    moteSeeds[index] = Math.random() * Math.PI * 2;
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = new THREE.PointsMaterial({
    map: makeMoteTexture(),
    color: zone.motes.color,
    size: zone.motes.size,
    transparent: true,
    opacity: zone.motes.opacity,
    depthWrite: false,
    blending: zone.motes.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.frustumCulled = false;
  scene.add(motes);

  // HDR pipeline: MSAA render target, subtle bloom, then tone-mapped output.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.26, 0.55, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const heroRig = buildRig(config.hero);
  heroRig.root.position.copy(HERO_POS);
  heroRig.root.rotation.y = Math.PI / 2;
  heroRig.root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(heroRig.root);

  const enemyRig = buildRig(config.enemy);
  enemyRig.root.position.copy(ENEMY_POS);
  enemyRig.root.rotation.y = -Math.PI / 2;
  enemyRig.root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
  scene.add(enemyRig.root);

  const hero: Fighter = {
    rig: heroRig, pos: HERO_POS.clone(), hp: config.playerHp, maxHp: config.playerMaxHp,
    anim: 'idle', animT: 0, animDur: 1, phase: 0, cooldown: 0, flash: 0, dead: false, struck: false, avatar: null,
    collisionRadius: 0.5,
  };
  const enemy: Fighter = {
    rig: enemyRig, pos: ENEMY_POS.clone(), hp: config.enemyHp, maxHp: config.enemyMaxHp,
    anim: 'idle', animT: 0, animDur: 1, phase: 0, cooldown: 0, flash: 0, dead: false, struck: false, avatar: null,
    collisionRadius: 0.5,
  };

  let combatSpacing = baseEnemyStop;
  let playerReach = Math.max(PLAYER_REACH, combatSpacing + 0.45);
  let enemyReach = Math.max(ENEMY_REACH + 0.25, combatSpacing + 0.7);

  function updateCombatSpacing() {
    combatSpacing = Math.max(baseEnemyStop, hero.collisionRadius + enemy.collisionRadius + 0.3);
    playerReach = Math.max(PLAYER_REACH, combatSpacing + 0.45);
    enemyReach = Math.max(ENEMY_REACH + 0.25, combatSpacing + 0.7);
  }

  const emissiveStates = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; intensity: number }>();
  const registerMaterial = (material: THREE.MeshStandardMaterial) => {
    emissiveStates.set(material, { color: material.emissive.clone(), intensity: material.emissiveIntensity });
  };
  [hero, enemy].forEach((fighter) => fighter.rig.mats.forEach(registerMaterial));

  attachAvatar(hero, config.heroModel, config.heroModelHeight ?? 1.88);
  attachAvatar(enemy, config.enemyModel, config.enemyModelHeight ?? 1.9);

  const particles: Particle[] = [];
  const floaters: { sprite: THREE.Sprite; life: number }[] = [];

  let resource = config.resource;
  const cooldowns: Record<string, number> = {};
  config.abilities.forEach((ability) => { cooldowns[ability.id] = 0; });
  const usedItems: string[] = [];
  let buffTimer = 0;
  let invuln = 0;
  let dodgeTimer = 0;
  let dodgeDir = new THREE.Vector3();
  let shake = 0;
  let hits = 0;
  let elapsed = 0;
  let phase: 'fight' | 'won' | 'lost' = 'fight';
  let endTimer = 0;
  let finished = false;
  let log: string[] = [`${config.enemyName} moves to strike.`];

  const keys = new Set<string>();
  let attackQueued = false;
  let dodgeQueued = false;

  const heroBox = heroRig.root;
  const enemyBox = enemyRig.root;

  function pushLog(line: string) {
    log = [...log.slice(-4), line];
  }

  function faceFighter(fighter: Fighter, target: THREE.Vector3, snap = false) {
    const dx = target.x - fighter.pos.x;
    const dz = target.z - fighter.pos.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    const wanted = Math.atan2(dx, dz);
    const current = fighter.rig.root.rotation.y;
    let delta = wanted - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    fighter.rig.root.rotation.y = snap ? wanted : current + delta * 0.28;
  }

  function setAnim(fighter: Fighter, kind: AnimKind, duration: number) {
    fighter.anim = kind;
    fighter.animT = 0;
    fighter.animDur = duration;
    if (kind === 'attack') fighter.struck = false;
  }

  function attachAvatar(fighter: Fighter, url: string | null, height: number) {
    if (!url) return;
    gltfLoader.load(url, (gltf) => {
      if (disposed) return;
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bounds.getSize(size);
      const baseScale = fighter.rig.root.scale.x || 1;
      const scale = height / Math.max(0.01, size.y) / baseScale;
      model.scale.setScalar(scale);
      model.position.y = -bounds.min.y * scale;
      model.rotation.y = MODEL_FACING;
      // Long beasts and winged bosses need a footprint derived from their visible geometry.
      const worldScale = scale * baseScale;
      const sideRadius = size.x * worldScale * 0.5;
      const frontRadius = bounds.max.z * worldScale;
      fighter.collisionRadius = Math.max(
        fighter.collisionRadius,
        clamp(Math.max(sideRadius, frontRadius), 0.45, 3.25),
      );
      updateCombatSpacing();
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true;
        node.receiveShadow = true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            fighter.rig.mats.push(material);
            registerMaterial(material);
          }
        });
      });

      const container = new THREE.Group();
      container.add(model);
      fighter.rig.root.add(container);
      fighter.rig.body.visible = false;

      const set = BEAST_MODEL.test(url) ? BEAST_CLIPS : HUMANOID_CLIPS;
      const names = gltf.animations.map((clip) => clip.name);
      const mixer = new THREE.AnimationMixer(model);
      const actions = new Map<string, THREE.AnimationAction>();
      const clips = {} as Record<AnimKind, string | null>;
      const assign = (kind: AnimKind, candidates: string[]) => {
        const found = clipName(names, candidates);
        clips[kind] = found;
        if (!found || actions.has(found)) return;
        const clip = gltf.animations.find((entry) => entry.name === found);
        if (!clip) return;
        const action = mixer.clipAction(clip);
        const loop = kind === 'idle' || kind === 'run' || kind === 'dodge';
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        action.clampWhenFinished = !loop;
        actions.set(found, action);
      };
      assign('idle', set.idle);
      assign('run', set.run);
      assign('attack', set.attack);
      assign('cast', set.cast);
      assign('hit', set.hit);
      assign('death', set.death);
      assign('dodge', set.dodge);
      assign('windup', set.attack);

      const idleClip = clips.idle;
      const idleAction = idleClip ? actions.get(idleClip) : null;
      if (idleAction) idleAction.play();
      fighter.avatar = { root: container, mixer, actions, clips, current: idleClip ?? '' };
    });
  }

  function syncAvatar(fighter: Fighter, dt: number) {
    const avatar = fighter.avatar;
    if (!avatar) return;
    avatar.mixer.update(dt);
    const kind: AnimKind = fighter.dead ? 'death' : fighter.anim === 'windup' ? 'attack' : fighter.anim;
    const wanted = avatar.clips[kind] ?? avatar.clips.idle;
    if (!wanted || wanted === avatar.current) return;
    const next = avatar.actions.get(wanted);
    if (!next) return;
    const prev = avatar.actions.get(avatar.current);
    next.reset();
    next.timeScale = kind === 'attack' ? (fighter.anim === 'windup' ? 0.8 : 1.35) : 1;
    next.fadeIn(0.12).play();
    if (prev && prev !== next) prev.fadeOut(0.12);
    avatar.current = wanted;
  }

  function spawnSparks(position: THREE.Vector3, color: number, count: number) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), material.clone());
      mesh.position.copy(position);
      mesh.position.z += (Math.random() - 0.5) * 0.2;
      scene.add(mesh);
      particles.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5.5, Math.random() * 4.2 + 0.6, (Math.random() - 0.5) * 5.5),
        life: 0.5 + Math.random() * 0.25,
        max: 0.75,
      });
    }
    const flash = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.28, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 1, side: THREE.DoubleSide }),
    );
    flash.position.copy(position);
    flash.lookAt(camera.position);
    scene.add(flash);
    particles.push({ mesh: flash, vel: new THREE.Vector3(0, 0, 0), life: 0.32, max: 0.32 });
  }

  function spawnFloat(position: THREE.Vector3, text: string, color: string) {
    const sprite = makeTextSprite(text, color);
    sprite.position.copy(position);
    sprite.position.y += 2.05;
    scene.add(sprite);
    floaters.push({ sprite, life: 1.05 });
  }

  function playerDamage() {
    if (Math.random() < swingMissChance(config.playerLevel, config.enemyLevel, false)) {
      return { value: 0, crit: false, miss: true };
    }
    const raw = config.playerAttack * (0.85 + Math.random() * 0.3) * (buffTimer > 0 ? 1.25 : 1);
    const { dealt, crit } = rollDamage(raw, config.playerCrit / 100, 2, armorReduction(config.enemyArmor, config.playerLevel));
    return { value: dealt, crit, miss: false };
  }

  function enemyDamage() {
    if (Math.random() < swingMissChance(config.enemyLevel, config.playerLevel, true)) return 0;
    const raw = config.enemyMin + Math.random() * Math.max(1, config.enemyMax - config.enemyMin);
    const reduction = mobArmorReduction(config.playerArmor, config.enemyLevel, config.playerLevel);
    const crit = Math.random() < 0.05;
    return Math.max(1, Math.round(raw * (crit ? 2 : 1) * (1 - reduction)));
  }

  function hurtEnemy(value: number, crit: boolean) {
    enemy.hp = Math.max(0, enemy.hp - value);
    enemy.flash = 1;
    setAnim(enemy, 'hit', 0.42);
    spawnFloat(enemy.pos.clone(), `−${value}`, crit ? '#ffd257' : '#f4efe2');
    spawnSparks(new THREE.Vector3(enemy.pos.x, 1.25, enemy.pos.z), crit ? 0xffd257 : 0xffb066, crit ? 16 : 10);
    shake = Math.max(shake, crit ? 0.34 : 0.2);
    hits += 1;
    pushLog(crit ? `${config.enemyName} takes ${value} — critical!` : `${config.enemyName} takes ${value} damage.`);
    config.audio.playClip(`/woc/audio/${crit ? 'combat_crit_1' : 'impact_metal_1'}.mp3`, crit ? 0.6 : 0.5);
    if (enemy.hp <= 0 && !enemy.dead) {
      enemy.dead = true;
      setAnim(enemy, 'death', 1.4);
      phase = 'won';
      endTimer = 1.5;
      pushLog(`${config.enemyName} falls.`);
      config.audio.playClip('/woc/audio/ui_victory_1.mp3', 0.55);
    }
  }

  function hurtHero(value: number) {
    if (invuln > 0 || hero.dead) return;
    hero.hp = Math.max(0, hero.hp - value);
    hero.flash = 1;
    setAnim(hero, 'hit', 0.42);
    spawnFloat(hero.pos.clone(), `−${value}`, '#f2776b');
    spawnSparks(new THREE.Vector3(hero.pos.x, 1.25, hero.pos.z), 0xd8553f, 8);
    shake = Math.max(shake, 0.26);
    pushLog(`${config.playerName} is struck for ${value}.`);
    config.audio.playClip('/woc/audio/impact_flesh_2.mp3', 0.5);
    if (hero.hp <= 0) {
      hero.dead = true;
      setAnim(hero, 'death', 1.4);
      phase = 'lost';
      endTimer = 1.6;
      pushLog(`${config.playerName} falls.`);
      config.audio.playClip('/woc/audio/ui_death.mp3', 0.55);
    }
  }

  function beginAttack() {
    if (phase !== 'fight' || hero.dead) return;
    if (hero.anim === 'attack' || hero.anim === 'dodge' || hero.cooldown > 0) return;
    setAnim(hero, 'attack', ATTACK_TIME);
    hero.cooldown = 0.5;
    attackQueued = false;
    config.audio.playClip('/woc/audio/melee_swing_blade_1.mp3', 0.5);
  }

  function resolveHeroStrike() {
    const toEnemy = new THREE.Vector3().subVectors(enemy.pos, hero.pos);
    const distance = toEnemy.length();
    toEnemy.y = 0;
    toEnemy.normalize();
    const forward = new THREE.Vector3(Math.sin(hero.rig.root.rotation.y), 0, Math.cos(hero.rig.root.rotation.y));
    if (distance <= playerReach && forward.dot(toEnemy) > 0.15) {
      const { value, crit, miss } = playerDamage();
      if (miss) {
        spawnFloat(new THREE.Vector3(enemy.pos.x, 1.55, enemy.pos.z), 'MISS', '#c9c2b4');
        pushLog(`You miss ${config.enemyName}.`);
        config.audio.playClip('/woc/audio/melee_swing_blade_1.mp3', 0.3);
        return;
      }
      hurtEnemy(value, crit);
    }
  }

  function beginDodge() {
    if (phase !== 'fight' || hero.dead || dodgeTimer > 0) return;
    const dir = new THREE.Vector3();
    if (keys.has('a')) dir.x -= 1;
    if (keys.has('d')) dir.x += 1;
    if (keys.has('w')) dir.z -= 1;
    if (keys.has('s')) dir.z += 1;
    if (dir.lengthSq() === 0) dir.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), hero.rig.root.rotation.y);
    dodgeDir = dir.normalize();
    dodgeTimer = 0.28;
    invuln = 0.42;
    setAnim(hero, 'dodge', 0.3);
    config.audio.playClip('/woc/audio/ui_weapon_sheathe.mp3', 0.35);
  }

  function useAbility(id: string) {
    if (phase !== 'fight' || hero.dead) return;
    const ability = config.abilities.find((entry) => entry.id === id);
    if (!ability) return;
    if ((cooldowns[id] ?? 0) > 0 || resource < ability.cost) return;
    resource -= ability.cost;
    cooldowns[id] = Math.max(1.4, ability.cooldown * 1.6);
    setAnim(hero, 'cast', 0.6);
    config.audio.playClip(`/woc/audio/cast_${ability.school === 'physical' ? 'arcane' : ability.school}.mp3`, 0.42);

    if (ability.type === 'heal') {
      const healed = Math.min(hero.maxHp - hero.hp, Math.round(hero.maxHp * 0.2));
      hero.hp += healed;
      spawnFloat(hero.pos.clone(), `+${healed}`, '#8fe0a6');
      pushLog(`${ability.name} restores ${healed} health.`);
      config.audio.playClip('/woc/audio/heal_impact.mp3', 0.5);
    } else if (ability.type === 'damage') {
      const physical = ability.school === 'physical';
      const hit = physical
        ? 1 - swingMissChance(config.playerLevel, config.enemyLevel, false)
        : spellHitChance(config.playerLevel, config.enemyLevel);
      if (Math.random() > hit) {
        pushLog(physical ? `${ability.name} misses ${config.enemyName}.` : `${config.enemyName} resists ${ability.name}.`);
        return;
      }
      const base = config.playerAttack * (1.75 + Math.random() * 0.55) * (buffTimer > 0 ? 1.25 : 1);
      const { dealt, crit } = rollDamage(
        base,
        config.playerCrit / 100,
        physical ? 2 : 1.5,
        physical ? armorReduction(config.enemyArmor, config.playerLevel) : 0,
      );
      hurtEnemy(dealt, crit);
      pushLog(`${ability.name} ${crit ? 'crashes into' : 'hits'} ${config.enemyName} for ${dealt}.`);
    } else {
      buffTimer = 7;
      resource = Math.min(config.resourceMax, resource + 10);
      spawnFloat(hero.pos.clone(), 'EMPOWERED', '#ffd98a');
      pushLog(`${ability.name} empowers your strikes.`);
    }
  }

  function useItem(itemId: string, heal: number) {
    if (phase !== 'fight' || hero.dead) return;
    const amount = Math.min(hero.maxHp - hero.hp, Math.max(1, heal));
    hero.hp += amount;
    usedItems.push(itemId);
    spawnFloat(hero.pos.clone(), `+${amount}`, '#8fe0a6');
    pushLog(`You use an item and recover ${amount} health.`);
    config.audio.playClip('/woc/audio/heal_impact.mp3', 0.45);
  }

  const ai = { state: 'chase' as 'chase' | 'windup' | 'recover', timer: 0, sway: Math.random() * Math.PI * 2 };

  function enforceSeparation(moving: Fighter, stationary: Fighter) {
    const offset = new THREE.Vector3().subVectors(moving.pos, stationary.pos);
    offset.y = 0;
    const distance = offset.length();
    if (distance >= combatSpacing) return;
    if (distance < 0.0001) offset.set(moving === hero ? -1 : 1, 0, 0);
    else offset.divideScalar(distance);
    moving.pos.copy(stationary.pos).addScaledVector(offset, combatSpacing);
  }

  function updateEnemyAI(dt: number) {
    if (enemy.dead || phase !== 'fight') return;
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    const toHero = new THREE.Vector3().subVectors(hero.pos, enemy.pos);
    const distance = toHero.length();
    toHero.y = 0;
    const dir = toHero.clone().normalize();
    faceFighter(enemy, hero.pos);

    if (ai.state === 'chase') {
      if (distance > combatSpacing) {
        ai.sway += dt * 1.6;
        const strafe = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sin(ai.sway) * 0.35);
        const step = dir.clone().multiplyScalar(ENEMY_SPEED * dt).add(strafe.multiplyScalar(dt));
        enemy.pos.add(step);
        enemy.phase += dt * 8.2;
        enemy.anim = 'run';
        enemy.animT += dt;
      } else {
        ai.state = 'windup';
        ai.timer = 0.52;
        setAnim(enemy, 'windup', 0.52);
      }
    } else if (ai.state === 'windup') {
      ai.timer -= dt;
      if (ai.timer <= 0) {
        ai.state = 'recover';
        ai.timer = 0.85;
        setAnim(enemy, 'attack', 0.66);
        window.setTimeout(() => {
          if (!active || phase !== 'fight' || enemy.dead) return;
          if (enemy.pos.distanceTo(hero.pos) <= enemyReach) {
            const damage = enemyDamage();
            if (damage <= 0) {
              pushLog(`${config.enemyName} misses you.`);
              return;
            }
            hurtHero(damage);
          }
        }, 320);
      }
    } else {
      ai.timer -= dt;
      if (ai.timer <= 0) {
        ai.state = 'chase';
        enemy.phase = 0;
      }
    }

    enforceSeparation(enemy, hero);
  }

  function updateHero(dt: number) {
    if (hero.dead || phase !== 'fight') return;
    hero.cooldown = Math.max(0, hero.cooldown - dt);

    if (dodgeTimer > 0) {
      dodgeTimer = Math.max(0, dodgeTimer - dt);
      hero.pos.addScaledVector(dodgeDir, 8.2 * dt);
    } else {
      const move = new THREE.Vector3();
      if (keys.has('a')) move.x -= 1;
      if (keys.has('d')) move.x += 1;
      if (keys.has('w')) move.z -= 1;
      if (keys.has('s')) move.z += 1;
      if (move.lengthSq() > 0) {
        move.normalize();
        hero.pos.addScaledVector(move, PLAYER_SPEED * dt);
        hero.phase += dt * 9.4;
        if (hero.anim !== 'attack' && hero.anim !== 'cast') {
          hero.anim = 'run';
          hero.animT += dt;
        }
        faceFighter(hero, new THREE.Vector3(hero.pos.x + move.x, 0, hero.pos.z + move.z));
      } else if (hero.anim === 'run') {
        hero.anim = 'idle';
        hero.animT = 0;
      }
      faceFighter(hero, enemy.pos);
    }

    const radius = new THREE.Vector2(hero.pos.x, hero.pos.z).length();
    if (radius > ARENA_RADIUS) {
      const scale = ARENA_RADIUS / radius;
      hero.pos.x *= scale;
      hero.pos.z *= scale;
    }
    enforceSeparation(hero, enemy);

    if (attackQueued) beginAttack();
    if (dodgeQueued) beginDodge();
    attackQueued = false;
    dodgeQueued = false;

    if (hero.anim === 'attack' && !hero.struck && hero.animT >= STRIKE_AT) {
      hero.struck = true;
      resolveHeroStrike();
    }
  }

  function updateParticles(dt: number) {
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.life -= dt;
      if (particle.life <= 0) {
        scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        const material = particle.mesh.material;
        if (material instanceof THREE.Material) material.dispose();
        particles.splice(index, 1);
        continue;
      }
      particle.mesh.position.addScaledVector(particle.vel, dt);
      particle.vel.y -= 9.5 * dt;
      const material = particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = Math.max(0, particle.life / particle.max);
      }
      if (particle.mesh instanceof THREE.Sprite) continue;
      if (particle.vel.lengthSq() > 0.001) particle.mesh.rotation.x += dt * 4;
    }

    for (let index = floaters.length - 1; index >= 0; index -= 1) {
      const floater = floaters[index];
      floater.life -= dt;
      floater.sprite.position.y += dt * 1.15;
      const material = floater.sprite.material;
      if (material instanceof THREE.SpriteMaterial) material.opacity = Math.max(0, floater.life / 1.05);
      if (floater.life <= 0) {
        scene.remove(floater.sprite);
        floater.sprite.material.map?.dispose();
        floater.sprite.material.dispose();
        floaters.splice(index, 1);
      }
    }

    for (let index = 0; index < moteCount; index += 1) {
      const offset = index * 3;
      motePositions[offset] += Math.sin(elapsed * 0.45 + moteSeeds[index]) * dt * 0.08;
      motePositions[offset + 1] += zone.motes.rise * dt;
      motePositions[offset + 2] += Math.cos(elapsed * 0.32 + moteSeeds[index]) * dt * 0.05;
      if (zone.motes.rise >= 0 && motePositions[offset + 1] > 7) motePositions[offset + 1] = 0.08;
      if (zone.motes.rise < 0 && motePositions[offset + 1] < 0) motePositions[offset + 1] = 7;
    }
    moteGeometry.getAttribute('position').needsUpdate = true;
  }

  let hudClock = 0;
  let focusX = 0;
  let lastFrame = performance.now();
  let raf = 0;
  let active = true;

  function emitHud() {
    config.onHud({
      playerHp: Math.round(hero.hp),
      playerMaxHp: hero.maxHp,
      resource: Math.round(resource),
      resourceMax: config.resourceMax,
      enemyHp: Math.round(enemy.hp),
      enemyMaxHp: enemy.maxHp,
      cooldowns: { ...cooldowns },
      log,
      phase,
      elapsedMs: Math.round(elapsed * 1000),
    });
  }

  function tick(now: number) {
    if (!active) return;
    raf = window.requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!assetsReady) {
      composer.render(dt);
      return;
    }
    elapsed += dt;

    if (phase === 'fight') {
      updateHero(dt);
      updateEnemyAI(dt);
      resource = Math.min(config.resourceMax, resource + dt * 7);
      buffTimer = Math.max(0, buffTimer - dt);
    } else if (!finished) {
      endTimer -= dt;
      if (endTimer <= 0) {
        finished = true;
        config.onEnd({
          win: phase === 'won',
          playerHp: Math.round(hero.hp),
          resource: Math.round(resource),
          hits,
          durationMs: Math.round(elapsed * 1000),
          items: [...usedItems],
        });
      }
    }

    Object.keys(cooldowns).forEach((id) => { cooldowns[id] = Math.max(0, cooldowns[id] - dt); });
    invuln = Math.max(0, invuln - dt);

    [hero, enemy].forEach((fighter) => {
      fighter.animT += dt;
      if (fighter.flash > 0) fighter.flash = Math.max(0, fighter.flash - dt * 3.4);
      poseFighter(fighter, elapsed);
      syncAvatar(fighter, dt);
      fighter.rig.root.position.set(fighter.pos.x, 0, fighter.pos.z);
      const flare = fighter.flash;
      fighter.rig.mats.forEach((mat) => {
        const base = emissiveStates.get(mat);
        if (base) {
          mat.emissive.copy(base.color);
          mat.emissiveIntensity = base.intensity;
        } else {
          mat.emissive.setRGB(0, 0, 0);
        }
        if (flare > 0.01) {
          mat.emissive.r += flare * 0.8;
          mat.emissive.g += flare * 0.34;
          mat.emissive.b += flare * 0.26;
        }
      });
      if (fighter.anim === 'hit' && fighter.animT > fighter.animDur) fighter.anim = 'idle';
      if (fighter.anim === 'attack' && fighter.animT > fighter.animDur) fighter.anim = 'idle';
      if (fighter.anim === 'cast' && fighter.animT > fighter.animDur) fighter.anim = 'idle';
      if (fighter.anim === 'dodge' && fighter.animT > fighter.animDur) fighter.anim = 'idle';
    });

    updateParticles(dt);

    const midX = (hero.pos.x + enemy.pos.x) * 0.5;
    focusX += (clamp(midX * 0.9, -2.4, 2.4) - focusX) * Math.min(1, dt * 3.2);

    if (shake > 0.001) {
      shake = Math.max(0, shake - dt * 1.8);
      camera.position.set(
        baseCamera.x + focusX + (Math.random() - 0.5) * shake,
        baseCamera.y + (Math.random() - 0.5) * shake * 0.6,
        baseCamera.z + (Math.random() - 0.5) * shake * 0.5,
      );
    } else {
      camera.position.lerp(new THREE.Vector3(baseCamera.x + focusX, baseCamera.y, baseCamera.z), 0.18);
    }
    camera.lookAt(lookTarget.x + focusX, lookTarget.y, lookTarget.z);

    hudClock += dt;
    if (hudClock > 0.1) {
      hudClock = 0;
      emitHud();
    }

    composer.render(dt);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!assetsReady) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
      event.preventDefault();
      keys.add(key);
      return;
    }
    if (event.code === 'Space' || key === 'j') {
      event.preventDefault();
      attackQueued = true;
      return;
    }
    if (key === 'shift') {
      event.preventDefault();
      dodgeQueued = true;
      return;
    }
    if (/^[1-5]$/.test(key)) {
      event.preventDefault();
      const ability = config.abilities[Number(key) - 1];
      if (ability) useAbility(ability.id);
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (key === 'w' || key === 'a' || key === 's' || key === 'd') keys.delete(key);
  }

  function onPointerDown(event: PointerEvent) {
    if (assetsReady && event.button === 0) {
      attackQueued = true;
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    const narrow = camera.aspect < 0.85;
    const distanceScale = narrow ? clamp(1.05 / camera.aspect, 1, 2.2) : 1;
    baseCamera.y = baseHeight * (narrow ? 1.15 : 1);
    baseCamera.z = baseDistance * distanceScale;
    lookTarget.y = narrow ? 0.1 : defaultLookY;
    camera.fov = narrow ? 55 : 44;
    camera.updateProjectionMatrix();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', resize);
  resize();
  emitHud();
  raf = window.requestAnimationFrame(tick);

  return {
    strike() {
      if (assetsReady) attackQueued = true;
    },
    dodge() {
      if (assetsReady) dodgeQueued = true;
    },
    useAbility,
    useItem,
    dispose() {
      active = false;
      disposed = true;
      loading?.remove();
      [hero, enemy].forEach((fighter) => fighter.avatar?.mixer.stopAllAction());
      window.cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', resize);
      particles.forEach((particle) => {
        scene.remove(particle.mesh);
        particle.mesh.geometry.dispose();
        if (particle.mesh.material instanceof THREE.Material) particle.mesh.material.dispose();
      });
      floaters.forEach((floater) => {
        scene.remove(floater.sprite);
        floater.sprite.material.map?.dispose();
        floater.sprite.material.dispose();
      });
      scene.remove(motes);
      moteGeometry.dispose();
      moteMaterial.map?.dispose();
      moteMaterial.dispose();
      scene.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const material = node.material;
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
      groundTextures.forEach((texture) => texture.dispose());
      if (scene.background instanceof THREE.Texture) scene.background.dispose();
      scene.environment?.dispose();
      bloom.dispose();
      composer.dispose();
      ktx2.dispose();
      renderer.dispose();
    },
  };
}
