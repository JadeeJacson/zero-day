// 对局状态机：一单委托 = 潜入一家企业，依次打穿 4 个区段。
// 每个区段在三个候选节点里选一个下手（外围 / 中继 / 核心主机），
// 击穿任意一个即进入黑市——结构与「每 ante 选一个盲注」同构，但语义全部重写。
import { DISCIPLINES, Program, buildCodebase } from './cards';
import { Rng, mulberry32, pick, shuffled } from './rng';
import { HookCtx, ImplantDef, IMPLANTS } from './cyberware';
import { ScoreResult, scorePlay } from './scoring';
import { EventDef, EVENTS } from './events';

export type Phase = 'select' | 'battle' | 'shop' | 'event' | 'won' | 'lost';
export type NodeKind = 'perimeter' | 'relay' | 'core';
export type ProtocolId = 'ironwall' | 'blackout' | 'swarm';
export type ArchetypeId = 'balanced' | 'ghost' | 'breaker' | 'broker';
export type HandSortMode = 'value' | 'discipline';

export interface ArchetypeDef {
  id: ArchetypeId;
  zh: string;
  en: string;
  desc: string;
  startMoney: number;
  playsBonus: number;
  handBonus: number;
  shopDiscount: number;
}

// 角色不是新系统，而是开局的一个小承诺：让同一套 40 张程序库有不同的第一局路线。
export const ARCHETYPES: Record<ArchetypeId, ArchetypeDef> = {
  balanced: {
    id: 'balanced',
    zh: '自由潜袭者',
    en: 'Free Runner',
    desc: '没有额外修正，适合第一次了解系统。',
    startMoney: 40,
    playsBonus: 0,
    handBonus: 0,
    shopDiscount: 0,
  },
  ghost: {
    id: 'ghost',
    zh: '幽灵',
    en: 'Ghost',
    desc: '手牌上限 +1；开局资金较少。',
    startMoney: 30,
    playsBonus: 0,
    handBonus: 1,
    shopDiscount: 0,
  },
  breaker: {
    id: 'breaker',
    zh: '破门手',
    en: 'Breaker',
    desc: '每场多 1 个攻击窗口；黑市资金较少。',
    startMoney: 25,
    playsBonus: 1,
    handBonus: 0,
    shopDiscount: 0,
  },
  broker: {
    id: 'broker',
    zh: '掮客',
    en: 'Broker',
    desc: '义体与重掷费用 −10；开局资金充足。',
    startMoney: 60,
    playsBonus: 0,
    handBonus: 0,
    shopDiscount: 10,
  },
};

export const PROTOCOLS: Record<ProtocolId, { zh: string; en: string; desc: string }> = {
  ironwall: { zh: '铁幕协议', en: 'Iron Wall', desc: '核心主机阈值额外 ×1.25' },
  blackout: { zh: '静默封锁', en: 'Blackout', desc: '本战无法重编译' },
  swarm: { zh: '蜂群协议', en: 'Swarm', desc: '每次攻击后随机熔断 1 张手牌' },
};

export const NODE_INFO: Record<NodeKind, { zh: string; en: string; mult: number }> = {
  perimeter: { zh: '外围接入点', en: 'Perimeter', mult: 1 },
  relay: { zh: '中继枢纽', en: 'Relay Hub', mult: 1.5 },
  core: { zh: '核心主机', en: 'Core Host', mult: 2 },
};

export interface WingDef {
  base: number;
  rewards: [number, number, number]; // 外围 / 中继 / 核心 击穿报酬
}

// 数值全部为原创设计，集中于此与 cyberware.ts，供调参
export const WINGS: WingDef[] = [
  { base: 300, rewards: [30, 45, 60] },
  { base: 600, rewards: [40, 55, 70] },
  { base: 1200, rewards: [55, 70, 90] },
  { base: 2200, rewards: [70, 90, 110] },
];

// 企业与数据堡名称全部原创
export const CORPS = [
  { zh: '玄鸦网络', en: 'Corvid Networks', fortress: '鸦巢', traitId: 'intel', traitZh: '情报优势', traitDesc: '每场多 1 次重编译' },
  { zh: '白鲸数据', en: 'Beluga Data', fortress: '鲸腹', traitId: 'finance', traitZh: '浮息协议', traitDesc: '利息上限提高至 ¤50' },
  { zh: '赤瓷重工', en: 'Red Kiln Works', fortress: '窑心', traitId: 'overheat', traitZh: '过热线路', traitDesc: '所有节点阈值降低 10%' },
];

export interface NodeOption {
  kind: NodeKind;
  threshold: number;
  reward: number;
  protocol: ProtocolId | null;
}

export interface RunState {
  seed: number;
  rng: Rng;
  phase: Phase;
  wing: number; // 0..3
  archetype: ArchetypeDef;
  corp: (typeof CORPS)[number];
  money: number;
  /** Persistent program library for this run. Battle decks are shuffled from this array. */
  deck: Program[];
  draw: Program[];
  discard: Program[];
  hand: Program[];
  playsMax: number;
  discardsMax: number;
  handSize: number;
  playsLeft: number;
  discardsLeft: number;
  implants: ImplantDef[];
  humanityLoss: number;
  roundScore: number;
  threshold: number;
  nodeKind: NodeKind | null;
  protocol: ProtocolId | null;
  options: NodeOption[];
  usedProtocols: ProtocolId[];
  shopOffers: ImplantDef[];
  rerollCost: number;
  lastResult: ScoreResult | null;
  lastCashout: { reward: number; interest: number } | null;
  event: EventDef | null;
  eventHistory: string[];
}

// 人性损耗阶梯（向桌游的 Humanity Cost 机制致意，阈值为原创）：
// 15 → 攻击窗口 -1；22 → 重编译 -1；27 → 手牌上限 -2
// Five implants can currently add at most 29 humanity loss, so every step must
// be reachable while still making the last slot meaningfully dangerous.
export const HUMANITY_STEPS = { plays: 15, discards: 22, hand: 27 };

export const PATCH_COSTS = { boost: 30, rewrite: 40, remove: 50 } as const;
export const PATCH_MIN_DECK_SIZE = 12;

export const playsCap = (s: RunState) => Math.max(2, 4 - (s.humanityLoss >= HUMANITY_STEPS.plays ? 1 : 0));
export const discardsCap = (s: RunState) => Math.max(1, 3 - (s.humanityLoss >= HUMANITY_STEPS.discards ? 1 : 0));
export const handCap = (s: RunState) => Math.max(5, 8 - (s.humanityLoss >= HUMANITY_STEPS.hand ? 2 : 0));

export const interestOf = (money: number) => Math.min(40, Math.floor(money / 50) * 10);

export const interestOfRun = (s: RunState) =>
  Math.min(s.corp.traitId === 'finance' ? 50 : 40, Math.floor(s.money / 50) * 10);

export function newRun(seed?: number, archetypeId: ArchetypeId = 'balanced'): RunState {
  const archetype = ARCHETYPES[archetypeId] ?? ARCHETYPES.balanced;
  const s: RunState = {
    seed: seed ?? Math.floor(Math.random() * 2 ** 31),
    rng: () => 0, // 立即替换，占位以满足类型
    phase: 'select',
    wing: 0,
    archetype,
    corp: pick(CORPS, mulberry32(seed ?? Date.now())),
    money: archetype.startMoney,
    deck: buildCodebase(),
    draw: [],
    discard: [],
    hand: [],
    playsMax: 4,
    discardsMax: 3,
    handSize: 8,
    playsLeft: 4,
    discardsLeft: 3,
    implants: [],
    humanityLoss: 0,
    roundScore: 0,
    threshold: 0,
    nodeKind: null,
    protocol: null,
    options: [],
    usedProtocols: [],
    shopOffers: [],
    rerollCost: 50,
    lastResult: null,
    lastCashout: null,
    event: null,
    eventHistory: [],
  };
  s.rng = mulberry32(s.seed);
  genWingOptions(s);
  return s;
}

export function genWingOptions(s: RunState): void {
  const w = WINGS[s.wing];
  const pool: ProtocolId[] = (Object.keys(PROTOCOLS) as ProtocolId[]).filter(
    (p) => !s.usedProtocols.includes(p),
  );
  const protocol = pool.length > 0 ? pick(pool, s.rng) : pick(Object.keys(PROTOCOLS) as ProtocolId[], s.rng);
  const coreThreshold = Math.round((w.base * NODE_INFO.core.mult * (protocol === 'ironwall' ? 1.25 : 1)) / 5) * 5;
  s.options = [
    { kind: 'perimeter', threshold: w.base * NODE_INFO.perimeter.mult, reward: w.rewards[0], protocol: null },
    { kind: 'relay', threshold: Math.round((w.base * NODE_INFO.relay.mult) / 5) * 5, reward: w.rewards[1], protocol: null },
    { kind: 'core', threshold: coreThreshold, reward: w.rewards[2], protocol },
  ];
}

export function startBattle(s: RunState, optionIdx: number): void {
  const opt = s.options[optionIdx];
  s.phase = 'battle';
  s.nodeKind = opt.kind;
  s.protocol = opt.protocol;
  s.threshold = Math.round(opt.threshold * (s.corp.traitId === 'overheat' ? 0.9 : 1));
  s.roundScore = 0;
  s.playsMax = playsCap(s) + s.archetype.playsBonus;
  s.discardsMax = discardsCap(s) + (s.corp.traitId === 'intel' ? 1 : 0);
  s.handSize = handCap(s) + s.archetype.handBonus;
  s.playsLeft = s.playsMax;
  s.discardsLeft = opt.protocol === 'blackout' ? 0 : s.discardsMax;
  s.lastResult = null;
  // The deck is persistent within a run: shop patches finally give the player
  // a way to pursue a hand/build instead of relying only on random draws.
  s.draw = shuffled(s.deck, s.rng);
  s.discard = [];
  s.hand = [];
  drawTo(s, s.handSize);
}

export function drawTo(s: RunState, n: number): void {
  for (;;) {
    if (s.hand.length >= n) return;
    if (s.draw.length === 0) {
      if (s.discard.length === 0) return;
      s.draw = shuffled(s.discard, s.rng);
      s.discard = [];
    }
    const c = s.draw.pop();
    if (c) s.hand.push(c);
  }
}

export function canPlay(s: RunState, sel: number[]): boolean {
  return s.phase === 'battle' && s.playsLeft > 0 && sel.length >= 1 && sel.length <= 5;
}

export function canDiscard(s: RunState, sel: number[]): boolean {
  return s.phase === 'battle' && s.discardsLeft > 0 && sel.length >= 1;
}

/** Reorder only the visible hand; draw/discard order and deck ownership stay untouched. */
export function sortHand(s: RunState, mode: HandSortMode): boolean {
  if (s.phase !== 'battle' || s.hand.length < 2) return false;
  const order = (d: Program['d']) => DISCIPLINES.indexOf(d);
  s.hand = s.hand
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      if (mode === 'value' && a.card.v !== b.card.v) return b.card.v - a.card.v;
      if (mode === 'discipline' && a.card.d !== b.card.d) return order(a.card.d) - order(b.card.d);
      if (a.card.v !== b.card.v) return b.card.v - a.card.v;
      return a.index - b.index;
    })
    .map(({ card }) => card);
  return true;
}

function hookCtx(s: RunState, playedCount: number): HookCtx {
  return {
    playsLeft: s.playsLeft,
    discardsLeft: s.discardsLeft,
    money: s.money,
    implantCount: s.implants.length,
    playedCount,
    rng: s.rng,
  };
}

export function play(s: RunState, sel: number[]): ScoreResult | null {
  if (!canPlay(s, sel)) return null;
  const chosen = sel.map((i) => s.hand[i]);
  const result = scorePlay(chosen, s.implants, hookCtx(s, chosen.length));
  if (!result) return null;
  s.playsLeft--;
  s.roundScore += result.final;
  s.lastResult = result;
  const playedIds = new Set(chosen.map((c) => c.id));
  s.hand = s.hand.filter((c) => !playedIds.has(c.id));
  s.discard.push(...chosen);
  drawTo(s, s.handSize);

  if (s.roundScore >= s.threshold) {
    winNode(s);
  } else if (s.playsLeft === 0) {
    s.phase = 'lost';
  } else if (s.protocol === 'swarm' && s.hand.length > 0) {
    // 蜂群协议：攻击后熔断 1 张未使用手牌
    const i = Math.floor(s.rng() * s.hand.length);
    s.discard.push(s.hand.splice(i, 1)[0]);
    drawTo(s, s.handSize);
  }
  return result;
}

export function discardCards(s: RunState, sel: number[]): boolean {
  if (!canDiscard(s, sel)) return false;
  const ids = new Set(sel.map((i) => s.hand[i].id));
  s.discard.push(...s.hand.filter((c) => ids.has(c.id)));
  s.hand = s.hand.filter((c) => !ids.has(c.id));
  s.discardsLeft--;
  drawTo(s, s.handSize);
  return true;
}

function winNode(s: RunState): void {
  const opt = s.options.find((o) => o.kind === s.nodeKind);
  const reward = opt ? opt.reward : 0;
  const interest = interestOfRun(s);
  s.money += reward + interest;
  s.lastCashout = { reward, interest };
  if (s.protocol) s.usedProtocols.push(s.protocol);
  if (s.wing >= WINGS.length - 1) {
    s.phase = 'won';
  } else {
    openShop(s);
  }
}

function openShop(s: RunState): void {
  s.phase = 'shop';
  s.rerollCost = 50;
  rollOffers(s);
}

function rollOffers(s: RunState): void {
  const owned = new Set(s.implants.map((i) => i.id));
  const pool = IMPLANTS.filter((i) => !owned.has(i.id));
  s.shopOffers = shuffled(pool, s.rng).slice(0, 2);
}

export function buyImplant(s: RunState, id: string): boolean {
  if (s.phase !== 'shop' || s.implants.length >= 5) return false;
  const def = s.shopOffers.find((i) => i.id === id);
  const cost = shopPrice(s, def?.cost ?? Number.POSITIVE_INFINITY);
  if (!def || s.money < cost) return false;
  s.money -= cost;
  s.implants.push({ ...def, cost });
  s.humanityLoss += def.humanity;
  s.shopOffers = s.shopOffers.filter((i) => i.id !== id);
  return true;
}

export function sellImplant(s: RunState, id: string): boolean {
  if (s.phase !== 'shop') return false;
  const idx = s.implants.findIndex((i) => i.id === id);
  if (idx < 0) return false;
  const def = s.implants[idx];
  s.money += Math.floor(def.cost / 2);
  s.implants.splice(idx, 1);
  return true;
}

export function reroll(s: RunState): boolean {
  const cost = shopPrice(s, s.rerollCost);
  if (s.phase !== 'shop' || s.money < cost) return false;
  s.money -= cost;
  s.rerollCost += 10;
  rollOffers(s);
  return true;
}

export type PatchKind = keyof typeof PATCH_COSTS;

export const shopPrice = (s: RunState, base: number): number =>
  Math.max(10, base - s.archetype.shopDiscount);

/** Apply one cheap, run-local program-library modification from the shop. */
export function patchDeck(
  s: RunState,
  kind: PatchKind,
  targetIndex: number,
  discipline?: Program['d'],
): boolean {
  if (s.phase !== 'shop' || s.money < PATCH_COSTS[kind]) return false;
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= s.deck.length) return false;
  const target = s.deck[targetIndex];
  if (kind === 'boost') {
    if (target.v >= 10) return false;
    target.v += 1;
  } else if (kind === 'rewrite') {
    if (!discipline || target.d === discipline) return false;
    target.d = discipline;
  } else {
    if (s.deck.length <= PATCH_MIN_DECK_SIZE) return false;
    s.deck.splice(targetIndex, 1);
  }
  s.money -= PATCH_COSTS[kind];
  return true;
}

export function shopContinue(s: RunState): void {
  if (s.phase !== 'shop') return;
  s.event = pick(EVENTS, s.rng);
  s.phase = 'event';
}

export function canResolveEvent(s: RunState, choiceId: string): boolean {
  if (s.phase !== 'event' || !s.event) return false;
  const choice = s.event.choices.find((c) => c.id === choiceId);
  if (!choice) return false;
  return s.money + (choice.effect.money ?? 0) >= 0;
}

function applyEventEffect(s: RunState, effect: EventDef['choices'][number]['effect']): void {
  s.money = Math.max(0, s.money + (effect.money ?? 0));
  s.humanityLoss = Math.max(0, s.humanityLoss + (effect.humanity ?? 0));
  for (let i = 0; i < (effect.boostRandom ?? 0); i++) {
    if (s.deck.length === 0) break;
    const target = s.deck[Math.floor(s.rng() * s.deck.length)];
    target.v = Math.min(10, target.v + 1);
  }
  for (let i = 0; i < (effect.removeRandom ?? 0); i++) {
    if (s.deck.length <= PATCH_MIN_DECK_SIZE) break;
    s.deck.splice(Math.floor(s.rng() * s.deck.length), 1);
  }
}

export function resolveEvent(s: RunState, choiceId: string): boolean {
  if (!canResolveEvent(s, choiceId)) return false;
  const event = s.event!;
  const choice = event.choices.find((c) => c.id === choiceId)!;
  applyEventEffect(s, choice.effect);
  s.eventHistory.push(`${event.id}:${choice.id}`);
  s.event = null;
  s.wing++;
  s.phase = 'select';
  genWingOptions(s);
  return true;
}
