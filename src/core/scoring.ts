// 计分引擎：手法基准威力 + Σ参与牌强度 → 威力；威力 × 效率 = 穿透值。
// 产出事件流水，供 UI 逐步播放结算动画。
import { Program } from './cards';
import { evaluate } from './techniques';
import { HookCtx, ImplantDef } from './cyberware';

export interface ScoreEvent {
  kind: 'tech' | 'card' | 'implant';
  label: string;
  power?: number; // 本步威力增量
  eff?: number; // 本步效率增量
  powerTotal: number; // 累计威力
  effTotal: number; // 累计效率
}

export interface ScoreResult {
  techId: string;
  techZh: string;
  cards: Program[];
  events: ScoreEvent[];
  power: number;
  eff: number;
  final: number;
}

export function scorePlay(
  selected: Program[],
  implants: ImplantDef[],
  ctx: HookCtx,
): ScoreResult | null {
  const ev = evaluate(selected);
  if (!ev) return null;
  const { tech, cards } = ev;
  let power = tech.base;
  let eff = tech.eff;
  const events: ScoreEvent[] = [];
  const push = (e: Omit<ScoreEvent, 'powerTotal' | 'effTotal'>) => {
    events.push({ ...e, powerTotal: power, effTotal: eff });
  };

  push({ kind: 'tech', label: `${tech.zh}（${tech.en}）`, power, eff });

  for (const c of cards) {
    power += c.v;
    push({ kind: 'card', label: `程序 · 强度 ${c.v}`, power: c.v });
    for (const im of implants) {
      if (!im.onCard) continue;
      const fx = im.onCard(c, ctx);
      if (!fx) continue;
      if (fx.power) power += fx.power;
      if (fx.eff) eff += fx.eff;
      push({ kind: 'implant', label: im.zh, power: fx.power, eff: fx.eff });
    }
  }

  for (const im of implants) {
    if (!im.onPlay) continue;
    const fx = im.onPlay(ctx);
    if (!fx) continue;
    if (fx.power) power += fx.power;
    if (fx.eff) eff += fx.eff;
    push({ kind: 'implant', label: im.zh, power: fx.power, eff: fx.eff });
  }

  return { techId: tech.id, techZh: tech.zh, cards, events, power, eff, final: power * eff };
}
