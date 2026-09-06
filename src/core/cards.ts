// 程序卡（软件库）：4 条入侵纪律 × 强度 1–10，共 40 张
// 强度沿用 d10 表意——向桌游根单（d10 检定）致意，数值本身为原创设计
export type Discipline = 'crack' | 'stealth' | 'breach' | 'extract';

export const DISCIPLINES: Discipline[] = ['crack', 'stealth', 'breach', 'extract'];

export const DISCIPLINE_INFO: Record<
  Discipline,
  { zh: string; en: string; glyph: string; cls: string }
> = {
  crack: { zh: '破译', en: 'Crack', glyph: '破', cls: 'd-crack' },
  stealth: { zh: '隐匿', en: 'Stealth', glyph: '隐', cls: 'd-stealth' },
  breach: { zh: '压制', en: 'Breach', glyph: '压', cls: 'd-breach' },
  extract: { zh: '提取', en: 'Extract', glyph: '取', cls: 'd-extract' },
};

export interface Program {
  id: string; // 类别-强度，全库唯一
  d: Discipline;
  v: number; // 强度 Rating，1–10
}

export function buildCodebase(): Program[] {
  const out: Program[] = [];
  for (const d of DISCIPLINES) {
    for (let v = 1; v <= 10; v++) {
      out.push({ id: `${d}-${v}`, d, v });
    }
  }
  return out;
}
