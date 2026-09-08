// 手法（Technique）：替代扑克牌型的原创组合系统。
// 关键差异：类别（纪律）的同/异决定组合，强度只参与求和与连续判定——
// 与扑克「点数成对」的逻辑正好倒置。
import { Program } from './cards';

export interface Technique {
  id: string;
  zh: string;
  en: string;
  desc: string;
  descEn?: string;
  base: number; // 基准威力
  eff: number; // 效率（倍率）
  rank: number; // 同分时的决胜优先级
  match: (cs: Program[]) => boolean;
}

const allSame = (cs: Program[]) => cs.every((c) => c.d === cs[0].d);
const allDiff = (cs: Program[]) => new Set(cs.map((c) => c.d)).size === cs.length;
// 连续：去重后恰好 n 个互异强度构成连续区间（允许强度重复的牌留在组合外——
// 由最优子集搜索决定参与牌，这里只看子集本身）
const consecutive = (cs: Program[]) => {
  const u = [...new Set(cs.map((c) => c.v))].sort((a, b) => a - b);
  if (u.length !== cs.length) return false;
  for (let i = 1; i < u.length; i++) {
    if (u[i] !== u[i - 1] + 1) return false;
  }
  return true;
};

// 按 rank 降序排列；rank 表达「越稀有越优先展示」的次序
export const TECHNIQUES: Technique[] = [
  { id: 'fulldive', zh: '完全潜袭', en: 'Full Dive', desc: '5 张同类别且强度连续', descEn: '5 same-discipline cards in sequence', base: 120, eff: 8, rank: 12, match: (cs) => cs.length === 5 && allSame(cs) && consecutive(cs) },
  { id: 'flood', zh: '数据洪流', en: 'Data Flood', desc: '5 张同类别', descEn: '5 cards of one discipline', base: 70, eff: 5, rank: 11, match: (cs) => cs.length === 5 && allSame(cs) },
  { id: 'spiral', zh: '螺旋降维', en: 'Spiral Descent', desc: '5 张强度连续', descEn: '5 cards in sequence', base: 60, eff: 4, rank: 10, match: (cs) => cs.length === 5 && consecutive(cs) },
  { id: 'array', zh: '阵列冲击', en: 'Array Strike', desc: '4 张同类别', descEn: '4 cards of one discipline', base: 40, eff: 3, rank: 9, match: (cs) => cs.length === 4 && allSame(cs) },
  { id: 'cascade', zh: '梯度瀑布', en: 'Cascade', desc: '4 张强度连续', descEn: '4 cards in sequence', base: 40, eff: 4, rank: 8, match: (cs) => cs.length === 4 && consecutive(cs) },
  { id: 'spectrum', zh: '四象全谱', en: 'Full Spectrum', desc: '4 张、四类别各一', descEn: '4 cards, one per discipline', base: 35, eff: 4, rank: 7, match: (cs) => cs.length === 4 && allDiff(cs) },
  { id: 'focus', zh: '聚焦脉冲', en: 'Focus Pulse', desc: '3 张同类别', descEn: '3 cards of one discipline', base: 25, eff: 3, rank: 6, match: (cs) => cs.length === 3 && allSame(cs) },
  { id: 'link', zh: '链路穿透', en: 'Link Pierce', desc: '3 张强度连续', descEn: '3 cards in sequence', base: 25, eff: 2, rank: 5, match: (cs) => cs.length === 3 && consecutive(cs) },
  { id: 'scatter', zh: '散点扫描', en: 'Scatter Scan', desc: '3 张类别互异', descEn: '3 different disciplines', base: 20, eff: 2, rank: 4, match: (cs) => cs.length === 3 && allDiff(cs) },
  { id: 'resonance', zh: '共鸣脉冲', en: 'Resonance', desc: '2 张同类别', descEn: '2 cards of one discipline', base: 10, eff: 2, rank: 3, match: (cs) => cs.length === 2 && allSame(cs) },
  { id: 'volley', zh: '并行齐射', en: 'Parallel Volley', desc: '2 张任意', descEn: 'Any 2 cards', base: 12, eff: 1, rank: 2, match: (cs) => cs.length === 2 },
  { id: 'solo', zh: '单点探测', en: 'Lone Probe', desc: '1 张任意', descEn: 'Any 1 card', base: 5, eff: 1, rank: 1, match: (cs) => cs.length === 1 },
];

export interface EvalResult {
  tech: Technique;
  cards: Program[]; // 参与结算的最优子集
}

// 最优子集搜索：在所选 1–5 张中枚举全部非空子集（≤31 个），
// 取「（基准威力 + Σ强度）× 效率」最高者；同分取 rank 更高的手法。
export function evaluate(selected: Program[]): EvalResult | null {
  const n = selected.length;
  if (n === 0 || n > 5) return null;
  let best: EvalResult | null = null;
  let bestFinal = -1;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: Program[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(selected[i]);
    }
    for (const t of TECHNIQUES) {
      if (!t.match(subset)) continue;
      const power = t.base + subset.reduce((s, c) => s + c.v, 0);
      const final = power * t.eff;
      if (final > bestFinal || (final === bestFinal && best && t.rank > best.tech.rank)) {
        bestFinal = final;
        best = { tech: t, cards: subset };
      }
    }
  }
  return best;
}
