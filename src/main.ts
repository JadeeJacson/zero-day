declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}

import './style.css';
import { DISCIPLINES, DISCIPLINE_INFO, Program } from './core/cards';
import { HookCtx, ImplantDef, sellPrice } from './core/cyberware';
import {
  ARCHETYPES,
  ArchetypeId,
  buildDeckForRule,
  canResolveEvent,
  DECK_RULES,
  deckRuleFor,
  DeckRuleId,
  isDeckRuleId,
  HandSortMode,
  NODE_INFO,
  PATCH_COSTS,
  PROTOCOLS,
  RunState,
  buyImplant,
  canDiscard,
  canPlay,
  discardCards,
  newRun,
  play,
  patchDeck,
  reroll,
  resolveEvent,
  sellImplant,
  sortHand,
  shopPrice,
  shopContinue,
  startBattle,
} from './core/run';
import { mulberry32 } from './core/rng';
import { scorePlay, ScoreEvent } from './core/scoring';
import { TECHNIQUES } from './core/techniques';
import { sfx } from './sfx';

let s: RunState | null = null;
let sel: number[] = [];
let busy = false;
let techTableOpen = false;
let tutorialOpen = false;
let fastAnimations = false;
let playRow: Program[] = []; // 正在结算的程序（视图状态）
let statsRecorded = false;
let pokiLoadingReported = false;
let pokiGameplayActive = false;
type Language = 'zh' | 'en';
let language: Language = readLanguage();

interface PokiSdkLike {
  gameLoadingFinished?: () => void;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
}

function pokiSdk(): PokiSdkLike | null {
  return (window as unknown as { PokiSDK?: PokiSdkLike }).PokiSDK ?? null;
}

function pokiLoadingFinished(): void {
  if (pokiLoadingReported) return;
  pokiLoadingReported = true;
  pokiSdk()?.gameLoadingFinished?.();
}

function pokiGameplay(start: boolean): void {
  if (start === pokiGameplayActive) return;
  pokiGameplayActive = start;
  if (start) pokiSdk()?.gameplayStart?.();
  else pokiSdk()?.gameplayStop?.();
}

const app = document.querySelector<HTMLDivElement>('#app')!;

// 氛围光球
const bg = document.createElement('div');
bg.id = 'bg';
bg.innerHTML = '<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>';
document.body.prepend(bg);

const fmt = (n: number) => n.toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, fastAnimations ? Math.min(80, ms * 0.22) : ms));
const TUTORIAL_KEY = 'zero-day-tutorial-v1';
const STATS_KEY = 'zero-day-run-stats-v1';
const RUN_SAVE_KEY = 'zero-day-run-v1';
const LANGUAGE_KEY = 'zero-day-language-v1';

function readLanguage(): Language {
  try {
    return localStorage.getItem('zero-day-language-v1') === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // 私密窗口可能禁用存储，当前会话仍可切换。
  }
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.body.dataset.lang = language;
  render();
}

const t = (zh: string, en: string): string => (language === 'zh' ? zh : en);
const localized = (item: { zh: string; en: string }): string => t(item.zh, item.en);
const languageButton = (): string => `<button class="btn ghost" id="btn-language" aria-label="${t('切换语言', 'CHANGE LANGUAGE')}">${t('语言', 'LANG')}</button>`;

function bindLanguage(): void {
  document.getElementById('btn-language')?.addEventListener('click', () => setLanguage(language === 'zh' ? 'en' : 'zh'));
}

function implantName(def: ImplantDef): string {
  return language === 'zh' ? def.zh : def.en;
}

function implantDesc(def: ImplantDef): string {
  return language === 'zh' ? def.desc : def.descEn ?? def.desc;
}

function techniqueName(id: string): string {
  const tech = TECHNIQUES.find((item) => item.id === id);
  return tech ? localized(tech) : id;
}

function scoreEventLabel(ev: ScoreEvent): string {
  if (ev.kind === 'tech') {
    const tech = TECHNIQUES.find((item) => ev.label.startsWith(item.zh));
    return language === 'zh' ? tech?.zh ?? ev.label.replace(/（[^）]*）/, '') : tech?.en ?? ev.label;
  }
  if (ev.kind === 'card') {
    const value = ev.label.match(/\d+/)?.[0] ?? '';
    return language === 'zh' ? `程序 · 强度 ${value}` : `Program · Strength ${value}`;
  }
  const implant = s?.implants.find((item) => ev.label.includes(item.zh));
  return language === 'zh' ? implant?.zh ?? ev.label : implant?.en ?? ev.label;
}

interface RunStats {
  runs: number;
  wins: number;
  bestMoney: number;
  bestWing: number;
}

function readStats(): RunStats {
  const fallback = { runs: 0, wins: 0, bestMoney: 0, bestWing: 0 };
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as RunStats;
  } catch {
    return fallback;
  }
}

function recordRun(run: RunState): void {
  if (statsRecorded) return;
  statsRecorded = true;
  const stats = readStats();
  const next = {
    runs: stats.runs + 1,
    wins: stats.wins + (run.phase === 'won' ? 1 : 0),
    bestMoney: Math.max(stats.bestMoney, run.money),
    bestWing: Math.max(stats.bestWing, run.wing + 1),
  };
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  } catch {
    // Private browsing can deny storage; the run result itself is still visible.
  }
}

function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberTutorial(): void {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // Private browsing can deny storage; the tutorial still closes for this run.
  }
}

function saveRun(): void {
  if (!s || s.phase === 'won' || s.phase === 'lost') return;
  try {
    localStorage.setItem(RUN_SAVE_KEY, JSON.stringify(s));
  } catch {
    // 存储被禁用时仍允许完整游玩；Poki 无痕窗口尤其常见。
  }
}

function loadRun(): RunState | null {
  try {
    const raw = localStorage.getItem(RUN_SAVE_KEY);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as RunState;
    if (!candidate || !['select', 'battle', 'shop', 'event'].includes(candidate.phase)) return null;
    // 兼容旧存档：新增的角色与牌库协议字段缺失时回退到标准配置。
    const savedArchetypeId = candidate.archetype?.id as ArchetypeId;
    candidate.archetype = ARCHETYPES[savedArchetypeId] ?? ARCHETYPES.balanced;
    candidate.deckRuleId = isDeckRuleId(candidate.deckRuleId) ? candidate.deckRuleId : 'standard';
    // Functions are intentionally omitted by JSON.stringify; rebuild the seeded RNG
    // so a resumed shop/event can continue instead of failing on the next random draw.
    candidate.rng = mulberry32(candidate.seed);
    return candidate;
  } catch {
    return null;
  }
}

function clearSavedRun(): void {
  try {
    localStorage.removeItem(RUN_SAVE_KEY);
  } catch {
    // ignore storage failures
  }
}

function previewCtx(): HookCtx {
  return {
    playsLeft: s?.playsLeft ?? 4,
    discardsLeft: s?.discardsLeft ?? 3,
    money: s?.money ?? 0,
    implantCount: s?.implants.length ?? 0,
    playedCount: sel.length,
    rng: mulberry32(0), // 预览用固定种子；混沌义体实际值以结算为准
    cardValueMultipliers: s ? deckRuleFor(s.deckRuleId).cardValueMultipliers : undefined,
  };
}

// ---------- 动画工具 ----------

function tick(el: HTMLElement, to: number, ms = 240): void {
  const from = Number(el.textContent.replace(/,/g, '')) || 0;
  if (from === to) return;
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(Math.round(from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bump(el: Element | null): void {
  if (!el) return;
  el.classList.remove('bump');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('bump');
}

function shake(big = false): void {
  const c = big ? 'shake-big' : 'shake';
  document.body.classList.remove('shake', 'shake-big');
  void document.body.offsetWidth;
  document.body.classList.add(c);
}

function floatText(anchor: Element | null, text: string, cls: string): void {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const f = document.createElement('span');
  f.className = `floater ${cls}`;
  f.textContent = text;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top - 6}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 900);
}

// ---------- 组件 ----------

function cardHtml(p: Program, idx: number, selected: boolean): string {
  const info = DISCIPLINE_INFO[p.d];
  const delay = ((idx * 0.53) % 2.2).toFixed(2);
  const discipline = language === 'zh' ? info.zh : info.en;
  const glyph = language === 'zh' ? info.glyph : info.en.slice(0, 3).toUpperCase();
  return `<div class="slot"><div class="card ${info.cls}${selected ? ' sel' : ''}" data-idx="${idx}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${discipline} ${t('强度', 'strength')} ${p.v}" title="${discipline} · ${p.v}" style="animation-delay:-${delay}s">
    <div class="wm">${language === 'zh' ? info.glyph : info.en.slice(0, 1).toUpperCase()}</div>
    <div class="corner">${glyph}<span>${discipline}</span></div>
    <div class="val mono">${p.v}</div>
    <div class="vcorner mono">${language === 'zh' ? `编号 ${String(p.v).padStart(2, '0')}` : `${p.d.slice(0, 2).toUpperCase()}-${String(p.v).padStart(2, '0')}`}</div>
  </div></div>`;
}

function tutorialHtml(): string {
  return `<div class="modal-mask tutorial-mask" id="tutorial-mask">
    <div class="modal tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <h3 id="tutorial-title">${t('第一次潜入', 'FIRST DIVE')}</h3>
      <div class="tutorial-grid">
        <div><b>${t('1 · 选节点', '1 · CHOOSE A NODE')}</b><p>${t('外围更安全，核心奖励更高，但会附带固执协议。', 'The perimeter is safer. The core pays more, but carries a Protocol.')}</p></div>
        <div><b>${t('2 · 组手法', '2 · BUILD A TECHNIQUE')}</b><p>${t('选 1–5 张程序。系统会从中自动取穿透最高的组合。', 'Select 1–5 programs. The strongest valid combination resolves automatically.')}</p></div>
        <div><b>${t('3 · 管资源', '3 · MANAGE RESOURCES')}</b><p>${t('攻击消耗窗口，重编译换牌；黑市可以装义体或改造程序库。', 'Attacks use windows. Recompile to redraw; the Black Market has implants and deck patches.')}</p></div>
      </div>
      <p class="rule">${t('建议先试一次“四象全谱”：四张不同纪律的程序，容易理解也很稳定。', 'Try Full Spectrum first: four different disciplines are easy to read and reliable.')}</p>
      <div style="margin-top:16px;text-align:right"><button class="btn primary" id="btn-close-tutorial">${t('开始', 'START')}</button></div>
    </div>
  </div>`;
}

function patchPanelHtml(): string {
  if (!s) return '';
  const deckCap = buildDeckForRule(s.deckRuleId).length;
  const cards = s.deck
    .map((p, i) => `<option value="${i}">${String(i + 1).padStart(2, '0')} · ${localized(DISCIPLINE_INFO[p.d])} ${p.v}</option>`)
    .join('');
  const disciplines = DISCIPLINES.map((d) => `<option value="${d}">${localized(DISCIPLINE_INFO[d])}</option>`).join('');
  return `<div class="patch-panel">
    <div class="patch-head"><span>${t('程序工作台', 'PROGRAM PATCH BAY')}</span><span class="patch-count">${t('牌库', 'DECK')} ${s.deck.length}/${deckCap}</span></div>
    <div class="patch-controls">
      <label>${t('目标程序', 'TARGET')}<select id="patch-card">${cards}</select></label>
      <label>${t('重写为', 'REWRITE AS')}<select id="patch-discipline">${disciplines}</select></label>
      <button class="btn mini" data-patch="boost" ${s.money < PATCH_COSTS.boost ? 'disabled' : ''}>${t('强化 +1', 'BOOST +1')} ¤${PATCH_COSTS.boost}</button>
      <button class="btn mini" data-patch="rewrite" ${s.money < PATCH_COSTS.rewrite ? 'disabled' : ''}>${t('重写纪律', 'REWRITE')} ¤${PATCH_COSTS.rewrite}</button>
      <button class="btn mini danger" data-patch="remove" ${s.money < PATCH_COSTS.remove ? 'disabled' : ''}>${t('隔离程序', 'ISOLATE')} ¤${PATCH_COSTS.remove}</button>
    </div>
    <div class="patch-hint">${t('改造会持续到本局结束；隔离至少保留 12 张程序，避免牌库失去基本循环。', 'Patches last for this run. At least 12 programs must remain in the deck.')}</div>
  </div>`;
}

function implantHtml(def: ImplantDef, mode: 'owned' | 'offer'): string {
  const displayCost = mode === 'offer' && s ? shopPrice(s, def.cost) : def.cost;
  const meta =
    mode === 'owned'
      ? `<button class="btn mini danger" data-sell="${def.id}">${t('卖出', 'SELL')} ¤${sellPrice(def)}</button>`
      : `<span class="shop-price">¤${displayCost}</span><button class="btn mini" data-buy="${def.id}">${t('接入', 'INSTALL')}</button>`;
  const name = implantName(def);
  const desc = implantDesc(def);
  const ownedClass = mode === 'owned' ? ' implant-owned' : '';
  const ownedAttrs = mode === 'owned'
    ? ` tabindex="0" title="${desc}" aria-label="${name}：${desc}"`
    : '';
  const tooltip = mode === 'owned'
    ? `<div class="implant-tooltip" role="tooltip"><span>${t('能力', 'ABILITY')}</span>${desc}</div>`
    : '';
  return `<div class="implant${ownedClass}"${ownedAttrs} data-implant="${def.id}">
    <div class="implant-name"><span class="badge">${language === 'zh' ? def.zh[0] : def.en[0]}</span><span class="implant-title">${name}</span></div>
    <div class="implant-desc">${desc}</div>
    <div class="implant-meta"><span class="humcost">${language === 'zh' ? `人性 −${def.humanity}` : `HUM −${def.humanity}`}</span>${meta}</div>
    ${tooltip}
  </div>`;
}

function header(): string {
  if (!s) return '';
  const deckRule = deckRuleFor(s.deckRuleId);
  const fortress = language === 'zh'
    ? s.corp.fortress
    : ({ 鸦巢: 'Crow Nest', 鲸腹: 'Whale Gut', 窑心: 'Kiln Core' } as Record<string, string>)[s.corp.fortress] ?? 'Data Fortress';
  const corpTrait = language === 'zh'
    ? { name: s.corp.traitZh, desc: s.corp.traitDesc }
    : {
        name: s.corp.traitId === 'intel' ? 'Intel Advantage' : s.corp.traitId === 'finance' ? 'Float Protocol' : 'Overheated Lines',
        desc: s.corp.traitId === 'intel' ? '+1 discard each battle' : s.corp.traitId === 'finance' ? 'Interest cap raised to ¤50' : 'All node thresholds −10%',
      };
  const archetypeDesc = language === 'zh'
    ? s.archetype.desc
    : s.archetype.descEn;
  return `<div class="topbar">
    <span class="logo">${language === 'zh' ? '零日' : 'ZERO-DAY'}</span>
    <span>${t('区段', 'WING')} <b>${s.wing + 1}</b>/4 · ${language === 'zh' ? `${s.corp.zh}「${fortress}」` : `${s.corp.en} “${fortress}”`}</span>
    <span class="archetype-tag" title="${archetypeDesc}">${language === 'zh' ? s.archetype.zh : s.archetype.en}</span>
    <span class="deck-rule-tag" title="${language === 'zh' ? deckRule.desc : deckRule.descEn}">${language === 'zh' ? deckRule.zh : deckRule.en}</span>
    <span class="corp-trait" title="${corpTrait.desc}">${corpTrait.name}</span>
    <span class="money">¤ <b>${s.money}</b></span>
    <span class="humtag">${language === 'zh' ? `人性 −${s.humanityLoss}` : `HUM −${s.humanityLoss}`}</span>
    <span class="seed mono">${language === 'zh' ? '种子' : 'SEED'} ${s.seed}</span>
    <button class="btn ghost" id="btn-speed">${t('结算', 'SPEED')} ${fastAnimations ? t('快', 'FAST') : t('慢', 'SLOW')}</button>
    <button class="btn ghost" id="btn-mute">${t('音效', 'SFX')} ${sfx.muted ? t('关', 'OFF') : t('开', 'ON')}</button>
    ${languageButton()}
  </div>`;
}

function implantsRow(): string {
  if (!s) return '';
  if (s.implants.length === 0) return `<div class="implants"><div class="implant-empty">${t('义体槽空空如也——黑市里有二手货', 'NO IMPLANTS INSTALLED — USED HARDWARE AHEAD')}</div></div>`;
  return `<div class="implants">${s.implants.map((i) => implantHtml(i, 'owned')).join('')}</div>`;
}

function techTableHtml(): string {
  const rows = [...TECHNIQUES]
    .sort((a, b) => b.rank - a.rank)
    .map(
      (t) => `<div class="tech-row">
      <span class="tech-name">${localized(t)}</span>
      <span class="tech-desc">${language === 'zh' ? t.desc : t.descEn ?? t.desc}</span>
      <span class="tech-val mono">${t.base} × ${t.eff}</span>
    </div>`,
    )
    .join('');
  return `<div class="modal-mask" id="modal-mask"><div class="modal">
    <h3>${t('手法表', 'TECHNIQUES')}</h3>
    <p class="rule">${t('威力 = 手法基准 + Σ参与程序强度；穿透 = 威力 × 效率。<br>攻击时自动从所选程序中枚举子集，取穿透最高的手法结算；同分取更稀有者。', 'Power = base + sum of card strength; Pierce = Power × Efficiency.<br>The strongest valid subset resolves automatically; ties favor the rarer technique.')}</p>
    ${rows}
    <div style="margin-top:16px;text-align:right"><button class="btn" id="btn-close-tech">${t('关闭', 'CLOSE')}</button></div>
  </div></div>`;
}

// ---------- 渲染 ----------

function render(): void {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.body.dataset.lang = language;
  if (s && s.phase !== 'won' && s.phase !== 'lost') saveRun();
  if (!s) return renderTitle();
  switch (s.phase) {
    case 'select':
      return renderSelect();
    case 'battle':
      return renderBattle();
    case 'shop':
      return renderShop();
    case 'event':
      return renderEvent();
    case 'won':
    case 'lost':
      return renderEnd();
  }
}

function renderTitle(): void {
  playRow = [];
  const stats = readStats();
  const saved = loadRun();
  const archetypes = Object.values(ARCHETYPES)
    .map((a) => `<option value="${a.id}">${language === 'zh' ? a.zh : a.en}</option>`)
    .join('');
  const deckRules = Object.values(DECK_RULES)
    .map((rule) => `<option value="${rule.id}">${language === 'zh' ? rule.zh : rule.en}</option>`)
    .join('');
  app.innerHTML = `<div class="screen title-screen">
    <div class="title-logo">${language === 'zh' ? '零 日' : 'ZERO DAY'}</div>
    <div class="title-sub">${language === 'zh' ? '零日 · 卡牌肉鸽' : 'A CARD ROGUELIKE'}</div>
    <div class="blurb">
      ${t('雾屿城的雨下了三十年。掮客「老蝉」给你转来一单委托：<br>潜进企业数据堡，把核心数据拽出来。你的全部本钱，<br>是一套手搓程序库和几件二手义体。逐层击穿，见好就收——<br>或者死在分期账单里。', 'The rain has fallen on Mist Isle for thirty years. A broker called Old Cicada has a job:<br>break into a corporate data fortress and pull out its core. You have a hand-built<br>program library and some second-hand implants. Push deeper, cash out—or drown in debt.')}
    </div>
    <div class="title-loadout">
      <label>${t('潜袭者', 'RUNNER')}<select id="archetype-input">${archetypes}</select></label>
      <label>${t('卡组协议', 'DECK PROTOCOL')}<select id="deck-rule-input">${deckRules}</select></label>
      <label>${t('挑战种子', 'CHALLENGE SEED')} <input id="seed-input" type="number" inputmode="numeric" placeholder="${t('随机', 'RANDOM')}"></label>
    </div>
    <div class="loadout-hint" id="loadout-hint"></div>
    <div class="title-actions">
      <button class="btn primary" id="btn-start">${t('开始潜入', 'START DIVE')}</button>
      ${saved ? `<button class="btn" id="btn-continue">${t('继续上次潜入', 'CONTINUE RUN')}</button>` : ''}
      <button class="btn" id="btn-title-tech">${t('手法表', 'TECHNIQUES')}</button>
      ${languageButton()}
    </div>
    <div class="title-stats">${language === 'zh' ? `本机记录：${stats.runs} 局 · ${stats.wins} 次完成 · 最佳资产 ¤${stats.bestMoney} · 最远区段 ${stats.bestWing}/4` : `LOCAL RECORDS: ${stats.runs} RUNS · ${stats.wins} CLEARS · BEST ¤${stats.bestMoney} · FARTHEST WING ${stats.bestWing}/4`}</div>
  </div>${techTableOpen ? techTableHtml() : ''}`;
  bindLanguage();
  const syncLoadoutHint = () => {
    const archetypeId = (document.getElementById('archetype-input') as HTMLSelectElement).value as ArchetypeId;
    const deckRuleId = (document.getElementById('deck-rule-input') as HTMLSelectElement).value as DeckRuleId;
    const archetype = ARCHETYPES[archetypeId] ?? ARCHETYPES.balanced;
    const deckRule = deckRuleFor(deckRuleId);
    const hint = document.getElementById('loadout-hint');
    if (hint) {
      hint.innerHTML = `<b>${language === 'zh' ? archetype.zh : archetype.en}</b> · ${language === 'zh' ? archetype.desc : archetype.descEn}<br><b>${language === 'zh' ? deckRule.zh : deckRule.en}</b> · ${language === 'zh' ? deckRule.desc : deckRule.descEn}`;
    }
  };
  document.getElementById('archetype-input')?.addEventListener('change', syncLoadoutHint);
  document.getElementById('deck-rule-input')?.addEventListener('change', syncLoadoutHint);
  syncLoadoutHint();
  document.getElementById('btn-start')!.onclick = () => {
    const rawSeed = (document.getElementById('seed-input') as HTMLInputElement).value.trim();
    const parsedSeed = rawSeed === '' ? undefined : Number(rawSeed);
    const archetypeId = (document.getElementById('archetype-input') as HTMLSelectElement).value as ArchetypeId;
    const deckRuleId = (document.getElementById('deck-rule-input') as HTMLSelectElement).value as DeckRuleId;
    s = newRun(Number.isInteger(parsedSeed) ? parsedSeed : undefined, archetypeId, deckRuleId);
    statsRecorded = false;
    tutorialOpen = !tutorialSeen();
    pokiGameplay(true);
    render();
  };
  document.getElementById('btn-continue')?.addEventListener('click', () => {
    const restored = loadRun();
    if (!restored) return;
    s = restored;
    sel = [];
    statsRecorded = false;
    tutorialOpen = false;
    render();
  });
  document.getElementById('btn-title-tech')!.onclick = () => {
    techTableOpen = !techTableOpen;
    render();
  };
  bindModal();
}

function renderSelect(): void {
  if (!s) return;
  playRow = [];
  const cards = s.options
    .map((o, i) => {
      const info = NODE_INFO[o.kind];
      const visibleThreshold = Math.round(o.threshold * (s!.corp.traitId === 'overheat' ? 0.9 : 1));
      const proto = o.protocol
        ? `<div class="protocol"><b>${t('固执协议', 'PROTOCOL')} · ${language === 'zh' ? PROTOCOLS[o.protocol].zh : PROTOCOLS[o.protocol].en}</b><br>${language === 'zh' ? PROTOCOLS[o.protocol].desc : PROTOCOLS[o.protocol].descEn}</div>`
        : '';
      return `<div class="nodecard k-${o.kind}" data-node="${i}" role="button" tabindex="0" aria-label="${localized(info)}, ${t('需要', 'requires')} ${fmt(visibleThreshold)} ${t('穿透', 'pierce')}, ${t('报酬', 'reward')} ${o.reward}">
        <div class="node-name">${localized(info)}</div>
        <div class="node-th mono">${fmt(visibleThreshold)}</div>
        <div>${t('击穿所需穿透', 'PIERCE REQUIRED')}</div>
        <div class="node-reward">${t('报酬', 'REWARD')} ¤${o.reward}</div>
        ${proto}
      </div>`;
    })
    .join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="h2">${t('选择下手节点 — 打穿任意一个即可深入', 'CHOOSE A NODE — BREAK ONE TO GO DEEPER')} · ${language === 'zh' ? s.corp.traitDesc : 'Choose your risk and reward'}</div>
    <div class="nodes">${cards}</div>
    ${implantsRow()}
  </div>${tutorialOpen ? tutorialHtml() : ''}`;
  bindLanguage();
  document.querySelectorAll('[data-node]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s || busy) return;
      sfx.launch();
      startBattle(s, Number((el as HTMLElement).dataset.node));
      render();
    });
    el.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.key !== 'Enter' && keyboard.key !== ' ') return;
      keyboard.preventDefault();
      (el as HTMLElement).click();
    });
  });
  bindTutorial();
}

function renderEvent(): void {
  if (!s || !s.event) return;
  const event = s.event;
  const choices = event.choices
    .map(
      (choice) => `<button class="event-choice" data-event-choice="${choice.id}" ${canResolveEvent(s!, choice.id) ? '' : 'disabled'}>
        <span class="event-choice-title">${language === 'zh' ? choice.title : choice.titleEn ?? choice.title}</span>
        <span class="event-choice-desc">${language === 'zh' ? choice.desc : choice.descEn ?? choice.desc}</span>
      </button>`,
    )
    .join('');
  app.innerHTML = `<div class="screen event-screen">
    ${header()}
    <div class="event-kicker">${t('截获信号', 'INTERCEPTED SIGNAL')}${language === 'en' ? ` · ${event.en}` : ''}</div>
    <div class="event-card">
      <div class="event-title">${language === 'zh' ? event.title : event.titleEn ?? event.title}</div>
      <p class="event-text">${language === 'zh' ? event.text : event.textEn ?? event.text}</p>
      <div class="event-choices">${choices}</div>
    </div>
    <div class="event-foot">${t('区段间事件 · 选择会影响资金、人性或程序库 · 当前牌库', 'BETWEEN-WING EVENT · CHOICE AFFECTS MONEY, HUMANITY OR DECK · DECK')} ${s.deck.length}</div>
  </div>`;
  bindLanguage();
  document.querySelectorAll('[data-event-choice]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      const choiceId = (el as HTMLElement).dataset.eventChoice;
      if (!choiceId || !resolveEvent(s, choiceId)) return;
      sfx.launch();
      render();
    });
  });
}

function scoringPanelHtml(): string {
  return `<div class="result" id="result">
    <div class="scoring">
      <div class="pchip"><span>${t('威力', 'POWER')}</span><b class="mono" id="pv">–</b></div>
      <span class="x">×</span>
      <div class="pchip mult"><span>${t('效率', 'EFFICIENCY')}</span><b class="mono" id="ev">–</b></div>
      <span class="x">=</span>
      <div class="pchip fin"><b class="mono" id="fv">–</b></div>
    </div>
    <div class="result-msg" id="result-msg"></div>
  </div>`;
}

function setMsg(html: string): void {
  const el = document.getElementById('result-msg');
  if (el) el.innerHTML = html;
}

function chip(el: HTMLElement, to: number): void {
  el.textContent = fmt(to);
  bump(el);
}

function updatePreview(): void {
  if (!s) return;
  const pv = document.getElementById('pv') as HTMLElement;
  const ev = document.getElementById('ev') as HTMLElement;
  const fv = document.getElementById('fv') as HTMLElement;
  const result = document.getElementById('result')!;
  if (sel.length === 0) {
    pv.textContent = ev.textContent = fv.textContent = '–';
    result.classList.remove('live');
    setMsg(t('选 1–5 张程序，此处预演穿透', 'Select 1–5 programs to preview Pierce'));
    return;
  }
  const chosen = sel.map((i) => s!.hand[i]);
  const r = scorePlay(chosen, s.implants, previewCtx());
  result.classList.add('live');
  if (!r) {
    setMsg(t('无法构成手法', 'No valid technique'));
    return;
  }
  pv.textContent = fmt(r.power);
  ev.textContent = fmt(r.eff);
  fv.textContent = fmt(r.final);
  const hint = r.cards.length < sel.length ? `<br><span style="opacity:.7">${t(`自动选取 ${r.cards.length} 张参与结算`, `Auto-selecting ${r.cards.length} cards`)}</span>` : '';
  setMsg(`<b>${techniqueName(r.techId)}</b>　${t('预计穿透', 'PIERCE')} ${fmt(r.final)}${hint}`);
}

function updateSelectionView(): void {
  if (!s) return;
  document.querySelectorAll<HTMLElement>('#hand .card').forEach((card) => {
    const idx = Number(card.dataset.idx);
    const selected = sel.includes(idx);
    card.classList.toggle('sel', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  const playButton = document.getElementById('btn-play') as HTMLButtonElement | null;
  const discardButton = document.getElementById('btn-discard') as HTMLButtonElement | null;
  if (playButton) playButton.disabled = !canPlay(s, sel);
  if (discardButton) discardButton.disabled = !canDiscard(s, sel);
  updatePreview();
}

function bindHandInteractions(): void {
  const hand = document.getElementById('hand');
  if (!hand) return;
  hand.onclick = (e) => {
    if (!s || busy) return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (!Number.isInteger(idx) || !s.hand[idx]) return;
    if (sel.includes(idx)) {
      sel = sel.filter((i) => i !== idx);
      sfx.unsel();
    } else if (sel.length < 5) {
      sel.push(idx);
      sfx.select();
    }
    // 只更新选中态、按钮和预演面板，避免替换整张 screen 导致闪烁。
    updateSelectionView();
  };
  hand.onkeydown = (e) => {
    const event = e as KeyboardEvent;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = (event.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el || busy) return;
    event.preventDefault();
    el.click();
  };
}

function renderHandOnly(): void {
  if (!s) return;
  const hand = document.getElementById('hand');
  if (!hand) return;
  hand.innerHTML = s.hand.map((c, i) => cardHtml(c, i, sel.includes(i))).join('');
  bindHandInteractions();
  updateSelectionView();
}

function bindHandSortControls(): void {
  document.querySelectorAll<HTMLElement>('[data-sort-hand]').forEach((el) => {
    el.onclick = () => {
      if (!s || busy) return;
      const selectedIds = new Set(sel.map((i) => s!.hand[i]?.id).filter(Boolean));
      const mode = el.dataset.sortHand as HandSortMode;
      if (!sortHand(s, mode)) return;
      sel = s.hand.reduce<number[]>((indices, card, index) => {
        if (selectedIds.has(card.id)) indices.push(index);
        return indices;
      }, []);
      sfx.select();
      renderHandOnly();
    };
  });
}

function renderBattle(): void {
  if (!s) return;
  const pct = Math.min(100, (s.roundScore / s.threshold) * 100);
  const proto = s.protocol
    ? `<div class="protocol" style="margin-top:10px"><b>${t('固执协议', 'PROTOCOL')} · ${language === 'zh' ? PROTOCOLS[s.protocol].zh : PROTOCOLS[s.protocol].en}</b>　${language === 'zh' ? PROTOCOLS[s.protocol].desc : PROTOCOLS[s.protocol].descEn}</div>`
    : '';
  const playRowHtml = playRow
    .map((p) => {
      const info = DISCIPLINE_INFO[p.d];
      const discipline = language === 'zh' ? info.zh : info.en;
      const glyph = language === 'zh' ? info.glyph : info.en.slice(0, 3).toUpperCase();
      return `<div class="slot"><div class="card ${info.cls}" data-pid="${p.id}">
      <div class="wm">${language === 'zh' ? info.glyph : info.en.slice(0, 1).toUpperCase()}</div>
      <div class="corner">${glyph}<span>${discipline}</span></div>
      <div class="val mono">${p.v}</div>
      <div class="vcorner mono">${language === 'zh' ? `编号 ${String(p.v).padStart(2, '0')}` : `${p.d.slice(0, 2).toUpperCase()}-${String(p.v).padStart(2, '0')}`}</div>
    </div></div>`;
    })
    .join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="nodebar ${s.protocol ? 'boss' : ''}">
      <div class="nodebar-head">
        <div class="node-name">${localized(NODE_INFO[s.nodeKind!])}</div>
        <div class="score-line"><b class="mono" id="score-num">${fmt(s.roundScore)}</b> / ${fmt(s.threshold)} ${t('穿透', 'PIERCE')}</div>
      </div>
      <div class="progress"><div id="score-fill" style="width:${pct}%"></div></div>
      <div class="counters">
        <span>${t('攻击窗口', 'ATTACKS')} <b id="plays">${s.playsLeft}/${s.playsMax}</b></span>
        <span>${t('重编译', 'DISCARDS')} <b id="discards">${s.discardsLeft}</b></span>
        <span>${t('程序库', 'DECK')} <b>${s.hand.length + s.draw.length + s.discard.length}</b></span>
      </div>
      ${proto}
    </div>
    ${implantsRow()}
    ${scoringPanelHtml()}
    <div class="playrow" id="playrow">${playRowHtml}</div>
    <div class="hand-head">
      <span class="hand-label">${t('程序手牌', 'PROGRAM HAND')}</span>
      <div class="hand-tools" aria-label="${t('整理手牌', 'SORT HAND')}">
        <span class="hand-tools-label">${t('整理', 'SORT')}</span>
        <button class="btn mini${s.handSortMode === 'value' ? ' active' : ''}" data-sort-hand="value" title="${t('强度从高到低', 'Highest strength first')}">${t('强度 ↓', 'POWER ↓')}</button>
        <button class="btn mini${s.handSortMode === 'discipline' ? ' active' : ''}" data-sort-hand="discipline" title="${t('按纪律分组', 'Group by discipline')}">${t('纪律', 'TYPE')}</button>
      </div>
    </div>
    <div class="hand" id="hand" aria-label="${t('程序手牌', 'PROGRAM HAND')}">${s.hand.map((c, i) => cardHtml(c, i, sel.includes(i))).join('')}</div>
    <div class="actions">
      <button class="btn primary" id="btn-play" ${canPlay(s, sel) ? '' : 'disabled'}>${t('攻击', 'ATTACK')}<span class="cnt">${s.playsLeft}/${s.playsMax}</span></button>
      <button class="btn" id="btn-discard" ${canDiscard(s, sel) ? '' : 'disabled'}>${t('重编译', 'RECOMPILE')}<span class="cnt">${s.discardsLeft}</span></button>
      <span class="spacer"></span>
      <button class="btn" id="btn-tech">${t('手法表', 'TECHNIQUES')}</button>
    </div>
  </div>${techTableOpen ? techTableHtml() : ''}`;

  bindHandInteractions();
  bindHandSortControls();
  bindLanguage();
  document.getElementById('btn-play')!.onclick = () => void attack();
  document.getElementById('btn-discard')!.onclick = () => void doDiscard();
  document.getElementById('btn-tech')!.onclick = () => {
    techTableOpen = true;
    render();
  };
  bindModal();
  updatePreview();
}

function renderShop(): void {
  if (!s) return;
  const cash = s.lastCashout;
  const owned =
    s.implants.length === 0
      ? `<div class="implant-empty">${t('还没有义体', 'NO IMPLANTS')}</div>`
      : s.implants.map((i) => implantHtml(i, 'owned')).join('');
  const offers =
    s.shopOffers.length === 0
      ? `<div class="sold-out">${t('货架已空（本局义体池有限）', 'SHELF EMPTY (LIMITED RUN POOL)')}</div>`
      : s.shopOffers.map((i) => implantHtml(i, 'offer')).join('');
  app.innerHTML = `<div class="screen shop-screen">
    ${header()}
    <div class="shop-banner">
      ${t('击穿确认。赃款到账', 'BREACH CONFIRMED. PAYOUT')}：<b>¤${cash?.reward ?? 0}</b>　${t('利息', 'INTEREST')} <b>¤${cash?.interest ?? 0}</b><br>
      <span style="font-size:12px;opacity:.75">${t('每 50 新元结余 +10 利息，上限 40 —— 攒钱也是一种策略', 'Every ¤50 held grants +10 interest, capped at ¤40 — saving is a strategy.')}</span>
    </div>
    ${patchPanelHtml()}
    <div class="h2">${t('已装载义体 — 人性损耗不可逆，卖出只退钱', 'INSTALLED IMPLANTS — HUMANITY LOSS IS PERMANENT')}</div>
    <div class="implants">${owned}</div>
    <div class="h2">${t('黑市货架', 'BLACK MARKET')}</div>
    <div class="shop-grid"><div class="shop-row shop-offers">${offers}</div>
      <div class="shop-row">
        <div class="implant utility-card"><div class="implant-name"><span class="badge">${language === 'zh' ? '掷' : 'R'}</span><span class="implant-title">${t('重掷货架', 'REROLL SHELF')}</span></div>
          <div class="implant-desc">${t('换一批义体。费用每次 +10；掮客折扣同样生效。', 'Refresh the implants. Cost rises by ¤10; Broker discount applies.')}</div>
          <div class="implant-meta"><span class="shop-price">¤${shopPrice(s, s.rerollCost)}</span>
          <button class="btn mini" id="btn-reroll" ${s.money >= shopPrice(s, s.rerollCost) ? '' : 'disabled'}>${t('重掷', 'REROLL')}</button></div>
        </div>
        <button class="btn primary" id="btn-next" style="margin-top:auto">${t('继续深入 ↓', 'GO DEEPER ↓')}</button>
      </div>
    </div>
  </div>`;
  bindLanguage();
  document.querySelectorAll('[data-buy]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      if (buyImplant(s, (el as HTMLElement).dataset.buy!)) sfx.buy();
      render();
    });
  });
  document.querySelectorAll('[data-patch]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      const cardSelect = document.getElementById('patch-card') as HTMLSelectElement | null;
      const disciplineSelect = document.getElementById('patch-discipline') as HTMLSelectElement | null;
      const kind = (el as HTMLElement).dataset.patch as 'boost' | 'rewrite' | 'remove';
      if (cardSelect && patchDeck(s, kind, Number(cardSelect.value), disciplineSelect?.value as Program['d'] | undefined)) {
        sfx.buy();
        render();
      }
    });
  });
  document.querySelectorAll('[data-sell]').forEach((el) => {
    el.addEventListener('click', () => {
      if (!s) return;
      if (sellImplant(s, (el as HTMLElement).dataset.sell!)) sfx.coin();
      render();
    });
  });
  document.getElementById('btn-reroll')!.onclick = () => {
    if (!s) return;
    if (reroll(s)) sfx.discard();
    render();
  };
  document.getElementById('btn-next')!.onclick = () => {
    if (!s) return;
    sfx.launch();
    shopContinue(s);
    render();
  };
}

function renderEnd(): void {
  if (!s) return;
  const won = s.phase === 'won';
  pokiGameplay(false);
  clearSavedRun();
  recordRun(s);
  const stats = readStats();
  app.innerHTML = `<div class="screen end-screen">
    <div class="end-title ${won ? 'won' : 'lost'}">${won ? t('全身而退', 'CLEAN EXTRACTION') : t('连接中断', 'CONNECTION LOST')}</div>
    <div class="end-text">${
      won
        ? t('核心数据到手。断线上浮，你把火漆一样的反向追踪甩在数据堡的残骸里。<br>雨还在下，霓虹在水洼里碎掉。老蝉的分成到账——这单，成了。', 'The core data is yours. You cut the line and leave the countertrace buried in the fortress wreckage.<br>The rain keeps falling. Old Cicada sends your cut — this job is clean.')
        : t('反向追踪锁定了你的接入点。权限被吊销，义体被远程锁死，<br>而欠掮客的那笔账，才刚刚开始计息。', 'The countertrace found your access point. Credentials revoked, implants locked remotely,<br>and the broker debt has only started accruing.')
    }</div>
    <div class="end-stats">
      ${t('最终资产', 'FINAL ASSETS')} <b>¤${s.money}</b> ｜ ${t('人性损耗', 'HUMANITY')} <b>−${s.humanityLoss}</b> ｜ ${t('到达区段', 'WING')} <b>${s.wing + 1}/4</b> ｜ ${t('种子', 'SEED')} <b>${s.seed}</b><br>
      ${language === 'zh' ? s.archetype.zh : s.archetype.en} · ${t('事件选择', 'EVENTS')} ${s.eventHistory.length} · ${t('本机胜率', 'LOCAL WINS')} ${stats.wins}/${stats.runs}
    </div>
    <button class="btn primary" id="btn-restart">${t('再潜一次', 'DIVE AGAIN')}</button>
    ${languageButton()}
  </div>`;
  bindLanguage();
  document.getElementById('btn-restart')!.onclick = () => {
    s = null;
    sel = [];
    render();
  };
}

function bindModal(): void {
  const mask = document.getElementById('modal-mask');
  if (!mask) return;
  mask.addEventListener('click', (e) => {
    if (e.target === mask) {
      techTableOpen = false;
      render();
    }
  });
  document.getElementById('btn-close-tech')!.onclick = () => {
    techTableOpen = false;
    render();
  };
}

function bindTutorial(): void {
  const close = document.getElementById('btn-close-tutorial');
  if (!close) return;
  close.addEventListener('click', () => {
    tutorialOpen = false;
    rememberTutorial();
    render();
  });
}

// ---------- 攻击结算动画 ----------

// 每个事件应把飘字挂在哪：还有后续牌未入账 → 挂当前牌；否则挂对应义体
function anchorFor(ev: ScoreEvent, idx: number, events: ScoreEvent[], cardEls: HTMLElement[]): Element | null {
  if (ev.kind === 'card') return cardEls[events.slice(0, idx + 1).filter((e) => e.kind === 'card').length - 1] ?? null;
  if (ev.kind === 'implant') {
    const moreCards = events.slice(idx + 1).some((e) => e.kind === 'card');
    if (moreCards) {
      const played = events.slice(0, idx + 1).filter((e) => e.kind === 'card').length;
      return cardEls[Math.max(0, played - 1)] ?? null;
    }
    const name = Array.from(document.querySelectorAll('.implant .implant-name'));
    return name.find((n) => n.textContent?.includes(ev.label))?.closest('.implant') ?? document.querySelector('.implants');
  }
  return null;
}

async function attack(): Promise<void> {
  if (!s || busy || !canPlay(s, sel)) return;
  busy = true;
  const chosenIdx = sel;
  const before = s.roundScore;
  const moneyBefore = s.money;
  const rects = chosenIdx.map(
    (i) => document.querySelector(`.hand .card[data-idx="${i}"]`)?.getBoundingClientRect() ?? null,
  );
  const chosen = chosenIdx.map((i) => s!.hand[i]);
  sel = [];
  playRow = chosen;
  sfx.launch();
  const result = play(s, chosenIdx);
  if (!result) {
    playRow = [];
    busy = false;
    return;
  }
  renderBattle();
  // 动画期间分数保持旧值，结算完毕再入账
  const numNow = document.getElementById('score-num') as HTMLElement;
  const fillNow = document.getElementById('score-fill') as HTMLElement;
  numNow.textContent = fmt(before);
  fillNow.style.width = `${Math.min(100, (before / s.threshold) * 100)}%`;
  const resultBox = document.getElementById('result')!;
  resultBox.classList.add('live');
  setMsg(`<b>${techniqueName(result.techId)}</b>　${t('结算中…', 'RESOLVING…')}`);

  // FLIP：从手牌原位滑入出牌区
  const fresh = Array.from(document.querySelectorAll('#playrow .card')) as HTMLElement[];
  fresh.forEach((el, i) => {
    const r0 = rects[i];
    if (!r0) return;
    const r1 = el.getBoundingClientRect();
    el.style.transition = 'none';
    el.style.transform = `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) rotate(${(Math.random() * 6 - 3).toFixed(1)}deg)`;
    el.style.zIndex = '6';
  });
  void document.body.offsetHeight;
  fresh.forEach((el, i) => {
    el.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.3, 1.15)';
    el.style.transitionDelay = `${i * 55}ms`;
    el.style.transform = '';
  });
  await sleep(340 + fresh.length * 55);
  fresh.forEach((el) => {
    el.style.transition = '';
    el.style.transitionDelay = '';
    el.style.zIndex = '';
  });

  const pv = document.getElementById('pv') as HTMLElement;
  const evEl = document.getElementById('ev') as HTMLElement;
  const fv = document.getElementById('fv') as HTMLElement;

  // 逐事件结算：弹卡 / 义体闪光 / 飘字 / 面板滚动
  for (let i = 0; i < result.events.length; i++) {
    const ev = result.events[i];
    const anchor = anchorFor(ev, i, result.events, fresh);
    if (ev.kind === 'card') {
      const el = anchor as HTMLElement | null;
      if (el) {
        el.classList.remove('hit');
        void el.offsetWidth;
        el.classList.add('hit');
      }
      sfx.tick(i);
    } else if (ev.kind === 'implant') {
      (anchor as HTMLElement | null)?.classList.remove('hit');
      bump(anchor);
      (anchor as HTMLElement | null)?.classList.add('hit');
      sfx.implant();
    } else {
      bump(pv.parentElement);
      bump(evEl.parentElement);
    }
    if (ev.power) {
      chip(pv, ev.powerTotal);
      floatText(anchor, t(`+${ev.power} 威力`, `+${ev.power} POWER`), 'pow');
    }
    if (ev.eff) {
      chip(evEl, ev.effTotal);
      floatText(anchor, t(`+${ev.eff} 效率`, `+${ev.eff} EFF`), 'eff');
    }
    setMsg(`<b>${scoreEventLabel(ev)}</b>`);
    await sleep(250);
  }

  // 最终一击
  pv.textContent = fmt(result.power);
  evEl.textContent = fmt(result.eff);
  fv.textContent = fmt(result.final);
  fv.classList.add('slam');
  sfx.slam();
  shake();
  setMsg(`<b>${techniqueName(result.techId)}</b>　${t('穿透', 'PIERCE')} <b style="color:var(--green)">${fmt(result.final)}</b>`);
  await sleep(500);

  // 入账 + 节点判定
  const num = document.getElementById('score-num')!;
  const fill = document.getElementById('score-fill') as HTMLElement;
  const total = before + result.final;
  tick(num, total, 420);
  fill.style.width = `${Math.min(100, (total / s.threshold) * 100)}%`;
  await sleep(480);

  const destroyed = total >= s.threshold;
  if (destroyed) {
    sfx.destroy();
    shake(true);
    setMsg(`<b style="color:var(--green)">${t('节点击穿！', 'NODE BREACHED!')}</b>`);
  } else if (s.phase === 'lost') {
    sfx.hurt();
    setMsg(`<b style="color:var(--red)">${t('反向追踪完成——连接中断', 'COUNTERTRACE COMPLETE — CONNECTION LOST')}</b>`);
  } else {
    setMsg(`${t('剩余攻击窗口', 'ATTACKS LEFT')} ${s.playsLeft}`);
  }
  await sleep(destroyed ? 850 : 600);

  fv.classList.remove('slam');
  playRow = [];
  busy = false;
  const phase = s.phase;
  render();
  if (phase === 'shop') {
    const mEl = document.querySelector('.topbar .money b') as HTMLElement | null;
    if (mEl && s.money !== moneyBefore) {
      mEl.textContent = fmt(moneyBefore);
      tick(mEl, s.money, 520);
      sfx.coin();
    }
  }
}

async function doDiscard(): Promise<void> {
  if (!s || busy || !canDiscard(s, sel)) return;
  busy = true;
  sfx.discard();
  const els = sel.map((i) => document.querySelector(`.hand .card[data-idx="${i}"]`));
  els.forEach((el) => el?.classList.add('discarding'));
  await sleep(230);
  discardCards(s, sel);
  sel = [];
  busy = false;
  render();
}

// ---------- 音效开关（顶栏重渲染不丢） ----------

document.addEventListener('click', (e) => {
  const muteButton = (e.target as HTMLElement).closest('#btn-mute');
  if (muteButton) {
    sfx.toggle();
    muteButton.textContent = `${t('音效', 'SFX')} ${sfx.muted ? t('关', 'OFF') : t('开', 'ON')}`;
  }
  const speed = (e.target as HTMLElement).closest('#btn-speed');
  if (speed) {
    fastAnimations = !fastAnimations;
    speed.textContent = `${t('结算', 'SPEED')} ${fastAnimations ? t('快', 'FAST') : t('慢', 'SLOW')}`;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    saveRun();
    pokiGameplay(false);
  } else if (s && s.phase === 'battle') {
    pokiGameplay(true);
  }
});
window.addEventListener('pagehide', () => saveRun());

// 生产构建不暴露调试入口；仅保留本地开发和自动化调试能力。
if (import.meta.env.DEV) {
  (window as unknown as { __zd: object }).__zd = {
    get run() {
      return s;
    },
    render: () => render(),
    select: (idxs: number[]) => {
      sel = idxs;
      render();
    },
  };
}

render();
pokiLoadingFinished();
