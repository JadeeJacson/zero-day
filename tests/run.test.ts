import { describe, expect, it } from 'vitest';
import { Program } from '../src/core/cards';
import {
  RunState,
  CORPS,
  WINGS,
  buyImplant,
  discardCards,
  interestOf,
  interestOfRun,
  newRun,
  patchDeck,
  play,
  reroll,
  sellImplant,
  shopContinue,
  startBattle,
} from '../src/core/run';

const mk = (d: Program['d'], v: number): Program => ({ id: `${d}-${v}`, d, v });

// 把想要的牌塞进手牌，并从抽牌堆里剔除同 id，保证无重复
function rigHand(s: RunState, cards: Program[]): void {
  const ids = new Set(cards.map((c) => c.id));
  s.hand = cards;
  s.draw = s.draw.filter((c) => !ids.has(c.id));
}

describe('对局流程', () => {
  it('新局：select 阶段，三个候选节点，初始资金 40', () => {
    const s = newRun(42);
    expect(s.phase).toBe('select');
    expect(s.options).toHaveLength(3);
    expect(s.money).toBe(40);
    expect(s.wing).toBe(0);
    expect(s.deck).toHaveLength(40);
  });

  it('程序工作台：强化、重写、隔离会持续到下一场战斗', () => {
    const s = newRun(42);
    s.phase = 'shop';
    s.money = 200;
    const original = s.deck[0];
    const originalValue = original.v;
    expect(patchDeck(s, 'boost', 0)).toBe(true);
    expect(s.deck[0].v).toBe(originalValue + 1);
    expect(patchDeck(s, 'rewrite', 0, 'extract')).toBe(true);
    expect(s.deck[0].d).toBe('extract');
    const before = s.deck.length;
    expect(patchDeck(s, 'remove', 0)).toBe(true);
    expect(s.deck).toHaveLength(before - 1);
    startBattle(s, 0);
    expect(s.draw.length + s.hand.length).toBe(before - 1);
  });

  it('候选节点阈值 = 区段基值 × 节点倍率，核心主机带固执协议', () => {
    const s = newRun(42);
    expect(s.options[0].threshold).toBe(WINGS[0].base);
    expect(s.options[1].threshold).toBe(Math.round((300 * 1.5) / 5) * 5);
    expect(s.options[2].threshold).toBeGreaterThanOrEqual(600);
    expect(s.options[2].protocol).not.toBeNull();
    expect(s.options[0].protocol).toBeNull();
  });

  it('开战：洗满 40 张、抽满手牌、窗口与重编译就位', () => {
    const s = newRun(42);
    startBattle(s, 0);
    expect(s.phase).toBe('battle');
    expect(s.hand).toHaveLength(8);
    expect(s.draw).toHaveLength(32);
    expect(s.playsLeft).toBe(4);
    expect(s.discardsLeft).toBe(3);
  });

  it('攻击：穿透入账、窗口 -1、自动补牌', () => {
    const s = newRun(42);
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 7)]);
    const r = play(s, [0, 1]);
    expect(r!.final).toBe(40);
    expect(s.roundScore).toBe(40);
    expect(s.playsLeft).toBe(3);
    expect(s.hand).toHaveLength(8);
    expect(s.discard).toHaveLength(2);
  });

  it('重编译：弃牌计数 -1 并补牌', () => {
    const s = newRun(42);
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 7)]);
    expect(discardCards(s, [0])).toBe(true);
    expect(s.discardsLeft).toBe(2);
    expect(s.hand).toHaveLength(8);
  });

  it('击穿节点 → 商店，报酬 + 利息入账', () => {
    const s = newRun(42);
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6), mk('crack', 7)]);
    play(s, [0, 1, 2, 3, 4]); // 完全潜袭 (120+25)×8 = 1160 ≥ 300
    expect(s.phase).toBe('shop');
    expect(s.money).toBe(40 + 30); // 利息：floor(40/50)=0
    expect(s.shopOffers).toHaveLength(2);
    expect(s.rerollCost).toBe(50);
  });

  it('利息：每 50 新元 +10，上限 40', () => {
    expect(interestOf(40)).toBe(0);
    expect(interestOf(100)).toBe(20);
    expect(interestOf(500)).toBe(40);
  });

  it('企业特性：情报增加重编译，白鲸提高利息上限，赤瓷降低阈值', () => {
    const intel = newRun(42);
    intel.corp = CORPS.find((c) => c.traitId === 'intel')!;
    startBattle(intel, 0);
    expect(intel.discardsMax).toBe(4);

    const finance = newRun(42);
    finance.corp = CORPS.find((c) => c.traitId === 'finance')!;
    finance.money = 300;
    expect(interestOfRun(finance)).toBe(50);

    const overheat = newRun(42);
    overheat.corp = CORPS.find((c) => c.traitId === 'overheat')!;
    startBattle(overheat, 0);
    expect(overheat.threshold).toBe(270);
  });

  it('购买义体：扣款、计入人性损耗', () => {
    const s = newRun(42);
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6), mk('crack', 7)]);
    play(s, [0, 1, 2, 3, 4]);
    s.money = 300;
    const def = s.shopOffers[0];
    expect(buyImplant(s, def.id)).toBe(true);
    expect(s.implants).toHaveLength(1);
    expect(s.humanityLoss).toBe(def.humanity);
    expect(s.money).toBe(300 - def.cost);
  });

  it('人性阶梯：累计损耗 ≥15 后攻击窗口 -1', () => {
    const s = newRun(42);
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6), mk('crack', 7)]);
    play(s, [0, 1, 2, 3, 4]);
    s.money = 1000;
    // 皮质调制器 5 + 镜像皮层 4 + 黑市账本 3 + 资金缓存 3 = 15
    s.shopOffers = [
      { id: 'cortical', zh: '皮质调制器', en: 'Cortical Modem', desc: '', cost: 80, humanity: 5 },
      { id: 'mirror-cortex', zh: '镜像皮层', en: 'Mirror Cortex', desc: '', cost: 90, humanity: 4 },
      { id: 'black-ledger', zh: '黑市账本', en: 'Black Ledger', desc: '', cost: 100, humanity: 3 },
      { id: 'cash-cache', zh: '资金缓存', en: 'Cash Cache', desc: '', cost: 90, humanity: 3 },
    ];
    for (const o of s.shopOffers.slice()) buyImplant(s, o.id);
    expect(s.humanityLoss).toBe(15);
    shopContinue(s);
    expect(s.phase).toBe('select');
    startBattle(s, 0);
    expect(s.playsLeft).toBe(3); // 4 - 1
    expect(s.discardsLeft).toBe(3); // 未达 22
  });

  it('人性阶梯：22 与 27 也可分别触发重编译与手牌惩罚', () => {
    const s = newRun(42);
    s.humanityLoss = 22;
    startBattle(s, 0);
    expect(s.playsLeft).toBe(3);
    expect(s.discardsLeft).toBe(2);
    s.humanityLoss = 27;
    startBattle(s, 0);
    expect(s.handSize).toBe(6);
    expect(s.hand).toHaveLength(6);
  });

  it('卖出义体：返半价，人性损耗不退还', () => {
    const s = newRun(42);
    s.phase = 'shop';
    s.implants = [
      { id: 'cortical', zh: '皮质调制器', en: '', desc: '', cost: 80, humanity: 5 },
    ];
    s.humanityLoss = 5;
    s.money = 0;
    expect(sellImplant(s, 'cortical')).toBe(true);
    expect(s.money).toBe(40);
    expect(s.implants).toHaveLength(0);
    expect(s.humanityLoss).toBe(5);
  });

  it('重掷：费用递增', () => {
    const s = newRun(42);
    s.phase = 'shop';
    s.money = 200;
    const before = s.shopOffers.map((o) => o.id);
    expect(reroll(s)).toBe(true);
    expect(s.money).toBe(150);
    expect(s.rerollCost).toBe(60);
    expect(s.shopOffers.map((o) => o.id)).not.toEqual(before);
  });

  it('窗口耗尽未击穿 → 失败', () => {
    const s = newRun(42);
    startBattle(s, 0);
    s.playsLeft = 1;
    rigHand(s, [mk('crack', 2), mk('crack', 3)]); // 共鸣 (10+5)×2 = 30 < 300
    play(s, [0, 1]);
    expect(s.phase).toBe('lost');
  });

  it('静默封锁：本战无重编译', () => {
    const s = newRun(42);
    s.options[2].protocol = 'blackout';
    startBattle(s, 2);
    expect(s.protocol).toBe('blackout');
    expect(s.discardsLeft).toBe(0);
    expect(s.playsLeft).toBe(4);
  });

  it('蜂群协议：每次攻击后熔断 1 张未使用手牌', () => {
    const s = newRun(42);
    s.options[2].protocol = 'swarm';
    startBattle(s, 2);
    rigHand(s, [mk('crack', 2), mk('crack', 3)]);
    play(s, [0, 1]);
    // 出牌 2 张 + 熔断 1 张进弃牌堆，再补 3 张
    expect(s.discard).toHaveLength(3);
    expect(s.hand).toHaveLength(8);
    expect(s.phase).toBe('battle');
  });

  it('终区段击穿 → 胜利', () => {
    const s = newRun(42);
    s.wing = WINGS.length - 1;
    startBattle(s, 0);
    rigHand(s, [mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6), mk('crack', 7)]);
    play(s, [0, 1, 2, 3, 4]);
    expect(s.phase).toBe('won');
  });

  it('同 seed 新局企业确定，且与不同 seed 相互独立', () => {
    const a = newRun(7);
    const b = newRun(7);
    expect(b.corp.zh).toBe(a.corp.zh);
  });
});
