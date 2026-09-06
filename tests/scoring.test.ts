import { describe, expect, it } from 'vitest';
import { Program } from '../src/core/cards';
import { HookCtx, IMPLANTS } from '../src/core/cyberware';
import { mulberry32, randInt } from '../src/core/rng';
import { scorePlay } from '../src/core/scoring';

const mk = (d: Program['d'], v: number): Program => ({ id: `${d}-${v}`, d, v });
const byId = (id: string) => IMPLANTS.find((i) => i.id === id);
const ctx = (over: Partial<HookCtx> = {}): HookCtx => ({
  playsLeft: 4,
  discardsLeft: 3,
  money: 0,
  implantCount: 1,
  playedCount: 2,
  rng: mulberry32(1),
  ...over,
});

describe('计分引擎', () => {
  it('无义体：威力 = 基准 + Σ强度，最终 = 威力 × 效率', () => {
    const r = scorePlay([mk('crack', 3), mk('crack', 7)], [], ctx());
    expect(r).not.toBeNull();
    expect(r!.power).toBe(10 + 3 + 7);
    expect(r!.eff).toBe(2);
    expect(r!.final).toBe(40);
    expect(r!.events[0].kind).toBe('tech');
  });

  it('提取协处理器：每张提取参与程序 效率 +3', () => {
    const r = scorePlay([mk('extract', 4), mk('extract', 6)], [byId('extract-coproc')!], ctx());
    expect(r!.power).toBe(10 + 10);
    expect(r!.eff).toBe(2 + 3 + 3);
    expect(r!.final).toBe(20 * 8);
  });

  it('神经缓冲器：重编译耗尽时 效率 +15，否则不触发', () => {
    const on = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('neural-buffer')!], ctx({ discardsLeft: 0 }));
    expect(on!.eff).toBe(2 + 15);
    const off = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('neural-buffer')!], ctx({ discardsLeft: 1 }));
    expect(off!.eff).toBe(2);
  });

  it('黑市账本：每剩余 1 次重编译 威力 +30', () => {
    const r = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('black-ledger')!], ctx({ discardsLeft: 2 }));
    expect(r!.power).toBe(10 + 10 + 60);
    expect(r!.final).toBe(80 * 2);
  });

  it('半脑开关：参与 ≤3 张 效率 +20', () => {
    const on = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('halfbrain')!], ctx({ playedCount: 3 }));
    expect(on!.eff).toBe(22);
    const off = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('halfbrain')!], ctx({ playedCount: 4 }));
    expect(off!.eff).toBe(2);
  });

  it('镜像皮层：每持有 1 件其他义体 效率 +3，仅自身时不触发', () => {
    const on = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('mirror-cortex')!], ctx({ implantCount: 3 }));
    expect(on!.eff).toBe(2 + 6);
    const off = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('mirror-cortex')!], ctx({ implantCount: 1 }));
    expect(off!.eff).toBe(2);
  });

  it('混沌协处理器：消耗 rng，结果可由同种子复现', () => {
    const expectedEff = 2 + randInt(mulberry32(7), 0, 23);
    const r = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('chaos-coproc')!], ctx({ rng: mulberry32(7) }));
    expect(r!.eff).toBe(expectedEff);
  });

  it('斐波那契栈：强度 1/2/3/5/8 每张 效率 +8', () => {
    const r = scorePlay([mk('crack', 1), mk('crack', 2)], [byId('fib-stack')!], ctx());
    expect(r!.power).toBe(10 + 3);
    expect(r!.eff).toBe(2 + 16);
    expect(r!.final).toBe(13 * 18);
  });

  it('重锤固件：强度 ≥9 每张 威力 +30', () => {
    const r = scorePlay([mk('breach', 9), mk('breach', 10)], [byId('hammer-fw')!], ctx());
    expect(r!.power).toBe(10 + 19 + 60);
    expect(r!.final).toBe(89 * 2);
  });

  it('资金缓存：每持有 20 新元 威力 +3', () => {
    const r = scorePlay([mk('crack', 3), mk('crack', 7)], [byId('cash-cache')!], ctx({ money: 100 }));
    expect(r!.power).toBe(10 + 10 + 15);
    expect(r!.final).toBe(35 * 2);
  });
});
