import { describe, expect, it } from 'vitest';
import { Program, buildCodebase } from '../src/core/cards';
import { evaluate } from '../src/core/techniques';

const mk = (d: Program['d'], v: number): Program => ({ id: `${d}-${v}`, d, v });

describe('代码库', () => {
  it('40 张且（类别， 强度）无重复', () => {
    const deck = buildCodebase();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((c) => c.id)).size).toBe(40);
  });
});

describe('手法判定', () => {
  it('1 张 → 单点探测', () => {
    expect(evaluate([mk('crack', 3)])?.tech.id).toBe('solo');
  });

  it('2 张同类别 → 共鸣脉冲', () => {
    const r = evaluate([mk('crack', 3), mk('crack', 7)]);
    expect(r?.tech.id).toBe('resonance');
    expect(r?.cards).toHaveLength(2);
  });

  it('2 张异类别 → 并行齐射', () => {
    expect(evaluate([mk('crack', 2), mk('breach', 9)])?.tech.id).toBe('volley');
  });

  it('异类 3 张中自动选取最优子集（共鸣 > 齐射）', () => {
    const r = evaluate([mk('crack', 3), mk('crack', 7), mk('breach', 9)]);
    expect(r?.tech.id).toBe('resonance');
    expect(r?.cards.map((c) => c.v).sort((a, b) => a - b)).toEqual([3, 7]);
  });

  it('3 张同类别且连续 → 聚焦脉冲（优于链路）', () => {
    expect(evaluate([mk('crack', 3), mk('crack', 4), mk('crack', 5)])?.tech.id).toBe('focus');
  });

  it('3 张连续 → 链路穿透（优于散点）', () => {
    expect(evaluate([mk('crack', 3), mk('breach', 4), mk('stealth', 5)])?.tech.id).toBe('link');
  });

  it('3 张互异非连续 → 散点扫描', () => {
    expect(evaluate([mk('crack', 2), mk('breach', 5), mk('stealth', 9)])?.tech.id).toBe('scatter');
  });

  it('4 张连续 → 梯度瀑布', () => {
    expect(evaluate([mk('crack', 2), mk('crack', 3), mk('breach', 4), mk('breach', 5)])?.tech.id).toBe('cascade');
  });

  it('4 张各一类别（非连续）→ 四象全谱', () => {
    expect(evaluate([mk('crack', 2), mk('breach', 3), mk('stealth', 4), mk('extract', 9)])?.tech.id).toBe('spectrum');
  });

  it('4 张同类别（非连续）→ 阵列冲击', () => {
    expect(evaluate([mk('crack', 1), mk('crack', 4), mk('crack', 6), mk('crack', 9)])?.tech.id).toBe('array');
  });

  it('4 张同类别且连续：瀑布效率更高，取瀑布而非阵列', () => {
    expect(evaluate([mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6)])?.tech.id).toBe('cascade');
  });

  it('5 张同类别非连续 → 数据洪流', () => {
    expect(evaluate([mk('crack', 1), mk('crack', 2), mk('crack', 3), mk('crack', 4), mk('crack', 9)])?.tech.id).toBe('flood');
  });

  it('5 张连续 → 螺旋降维', () => {
    expect(evaluate([mk('crack', 2), mk('breach', 3), mk('stealth', 4), mk('extract', 5), mk('crack', 6)])?.tech.id).toBe('spiral');
  });

  it('5 张同类别且连续 → 完全潜袭', () => {
    const r = evaluate([mk('crack', 3), mk('crack', 4), mk('crack', 5), mk('crack', 6), mk('crack', 7)]);
    expect(r?.tech.id).toBe('fulldive');
    expect(r?.cards).toHaveLength(5);
  });

  it('空选择返回 null', () => {
    expect(evaluate([])).toBeNull();
  });
});
