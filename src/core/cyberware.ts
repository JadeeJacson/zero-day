// 义体（植入体）：被动效果钩子，对应卡牌肉鸽底盘中「小丑牌」的位置。
// 数据驱动：新增义体只需在本表加一行，不改引擎。
import { Program } from './cards';
import { Rng, randInt } from './rng';

export interface Effect {
  power?: number;
  eff?: number;
}

export interface HookCtx {
  playsLeft: number;
  discardsLeft: number;
  money: number;
  implantCount: number; // 含自身
  playedCount: number; // 本次参与结算的程序张数
  rng: Rng;
  /** 开局牌库协议对不同纪律牌面强度的计分倍率。 */
  cardValueMultipliers?: Partial<Record<Program['d'], number>>;
}

export interface ImplantDef {
  id: string;
  zh: string;
  en: string;
  desc: string;
  descEn?: string;
  cost: number; // 新元
  humanity: number; // 人性损耗
  onCard?: (card: Program, ctx: HookCtx) => Effect | null; // 逐张（仅参与牌）
  onPlay?: (ctx: HookCtx) => Effect | null; // 每次攻击一次
}

export const IMPLANTS: ImplantDef[] = [
  {
    id: 'cortical', zh: '皮质调制器', en: 'Cortical Modem',
    desc: '每次攻击 效率 +4', descEn: 'Each attack: Efficiency +4.', cost: 60, humanity: 5,
    onPlay: () => ({ eff: 4 }),
  },
  {
    id: 'extract-coproc', zh: '提取协处理器', en: 'Extraction Coprocessor',
    desc: '每张【提取】参与程序 效率 +3', descEn: 'Each Extract card played: Efficiency +3.', cost: 70, humanity: 6,
    onCard: (c) => (c.d === 'extract' ? { eff: 3 } : null),
  },
  {
    id: 'assault-nerves', zh: '突击神经束', en: 'Assault Nerve Bundle',
    desc: '每张【压制】参与程序 效率 +3', descEn: 'Each Breach card played: Efficiency +3.', cost: 70, humanity: 6,
    onCard: (c) => (c.d === 'breach' ? { eff: 3 } : null),
  },
  {
    id: 'ghost-filament', zh: '幽灵纤维', en: 'Ghost Filament',
    desc: '每张【隐匿】参与程序 效率 +3', descEn: 'Each Stealth card played: Efficiency +3.', cost: 70, humanity: 6,
    onCard: (c) => (c.d === 'stealth' ? { eff: 3 } : null),
  },
  {
    id: 'crack-stacks', zh: '破译加速栈', en: 'Crack Accelerator Stack',
    desc: '每张【破译】参与程序 效率 +3', descEn: 'Each Crack card played: Efficiency +3.', cost: 70, humanity: 6,
    onCard: (c) => (c.d === 'crack' ? { eff: 3 } : null),
  },
  {
    id: 'neural-buffer', zh: '神经缓冲器', en: 'Neural Buffer',
    desc: '重编译次数耗尽时 效率 +15', descEn: 'When discards are empty: Efficiency +15.', cost: 65, humanity: 4,
    onPlay: (ctx) => (ctx.discardsLeft === 0 ? { eff: 15 } : null),
  },
  {
    id: 'mirror-cortex', zh: '镜像皮层', en: 'Mirror Cortex',
    desc: '每持有 1 件其他义体 效率 +3', descEn: 'Each other implant owned: Efficiency +3.', cost: 65, humanity: 4,
    onPlay: (ctx) => (ctx.implantCount > 1 ? { eff: (ctx.implantCount - 1) * 3 } : null),
  },
  {
    id: 'chaos-coproc', zh: '混沌协处理器', en: 'Chaos Coprocessor',
    desc: '每次攻击 效率 +0~23（不稳定）', descEn: 'Each attack: Efficiency +0–23 (unstable).', cost: 70, humanity: 5,
    onPlay: (ctx) => ({ eff: randInt(ctx.rng, 0, 23) }),
  },
  {
    id: 'fib-stack', zh: '斐波那契栈', en: 'Fibonacci Stack',
    desc: '强度为 1/2/3/5/8 的参与程序 每张 效率 +8', descEn: 'Cards valued 1/2/3/5/8: Efficiency +8 each.', cost: 80, humanity: 5,
    onCard: (c) => ([1, 2, 3, 5, 8].includes(c.v) ? { eff: 8 } : null),
  },
  {
    id: 'hammer-fw', zh: '重锤固件', en: 'Hammer Firmware',
    desc: '强度 ≥9 的参与程序 每张 威力 +30', descEn: 'Each card valued 9+: Power +30.', cost: 75, humanity: 5,
    onCard: (c) => (c.v >= 9 ? { power: 30 } : null),
  },
  {
    id: 'black-ledger', zh: '黑市账本', en: 'Black Ledger',
    desc: '每剩余 1 次重编译 威力 +30', descEn: 'Each remaining discard: Power +30.', cost: 65, humanity: 3,
    onPlay: (ctx) => (ctx.discardsLeft > 0 ? { power: ctx.discardsLeft * 30 } : null),
  },
  {
    id: 'halfbrain', zh: '半脑开关', en: 'Half-Brain Switch',
    desc: '参与程序 ≤3 张时 效率 +20', descEn: 'With 3 or fewer cards: Efficiency +20.', cost: 65, humanity: 5,
    onPlay: (ctx) => (ctx.playedCount <= 3 ? { eff: 20 } : null),
  },
  {
    id: 'cash-cache', zh: '资金缓存', en: 'Cash Cache',
    desc: '每持有 20 新元 威力 +3', descEn: 'Every ¤20 held: Power +3.', cost: 60, humanity: 3,
    onPlay: (ctx) => ({ power: Math.floor(ctx.money / 20) * 3 }),
  },
  {
    id: 'overclock-kernel', zh: '超频内核', en: 'Overclock Kernel',
    desc: '参与程序 ≥4 张时 效率 +12', descEn: 'With 4+ cards played: Efficiency +12.', cost: 75, humanity: 5,
    onPlay: (ctx) => (ctx.playedCount >= 4 ? { eff: 12 } : null),
  },
  {
    id: 'last-stand', zh: '末端协议', en: 'Last Stand Protocol',
    desc: '只剩 1 个攻击窗口时 威力 +50', descEn: 'With 1 attack left: Power +50.', cost: 75, humanity: 4,
    onPlay: (ctx) => (ctx.playsLeft === 1 ? { power: 50 } : null),
  },
  {
    id: 'checksum-needle', zh: '校验针', en: 'Checksum Needle',
    desc: '强度为 5 或 10 的参与程序 每张 威力 +18', descEn: 'Each card valued 5 or 10: Power +18.', cost: 70, humanity: 4,
    onCard: (c) => ([5, 10].includes(c.v) ? { power: 18 } : null),
  },
  {
    id: 'deadman-switch', zh: '死手开关', en: 'Deadhand Switch',
    desc: '重编译耗尽时 威力 +45', descEn: 'When discards are empty: Power +45.', cost: 70, humanity: 4,
    onPlay: (ctx) => (ctx.discardsLeft === 0 ? { power: 45 } : null),
  },
];

export const sellPrice = (def: ImplantDef) => Math.floor(def.cost / 2);
