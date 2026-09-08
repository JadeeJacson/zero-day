import './style.css';
import { DISCIPLINES, DISCIPLINE_INFO, Program } from './core/cards';
import { HookCtx, ImplantDef, sellPrice } from './core/cyberware';
import {
  ARCHETYPES,
  ArchetypeId,
  canResolveEvent,
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

const app = document.querySelector<HTMLDivElement>('#app')!;

// 氛围光球
const bg = document.createElement('div');
bg.id = 'bg';
bg.innerHTML = '<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>';
document.body.prepend(bg);

const fmt = (n: number) => n.toLocaleString('zh-CN');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, fastAnimations ? Math.min(80, ms * 0.22) : ms));
const TUTORIAL_KEY = 'zero-day-tutorial-v1';
const STATS_KEY = 'zero-day-run-stats-v1';

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

function previewCtx(): HookCtx {
  return {
    playsLeft: s?.playsLeft ?? 4,
    discardsLeft: s?.discardsLeft ?? 3,
    money: s?.money ?? 0,
    implantCount: s?.implants.length ?? 0,
    playedCount: sel.length,
    rng: mulberry32(0), // 预览用固定种子；混沌义体实际值以结算为准
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
  return `<div class="slot"><div class="card ${info.cls}${selected ? ' sel' : ''}" data-idx="${idx}" role="button" tabindex="0" aria-label="${info.zh} 强度 ${p.v}" style="animation-delay:-${delay}s">
    <div class="wm">${info.glyph}</div>
    <div class="corner">${info.glyph}<span>${info.zh}</span></div>
    <div class="val mono">${p.v}</div>
    <div class="tag en">${info.en.toUpperCase()}</div>
    <div class="vcorner mono">${p.d.slice(0, 2).toUpperCase()}-${String(p.v).padStart(2, '0')}</div>
  </div></div>`;
}

function tutorialHtml(): string {
  return `<div class="modal-mask tutorial-mask" id="tutorial-mask">
    <div class="modal tutorial-modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <h3 id="tutorial-title">第一次潜入</h3>
      <div class="tutorial-grid">
        <div><b>1 · 选节点</b><p>外围更安全，核心奖励更高，但会附带固执协议。</p></div>
        <div><b>2 · 组手法</b><p>选 1–5 张程序。系统会从中自动取穿透最高的组合。</p></div>
        <div><b>3 · 管资源</b><p>攻击消耗窗口，重编译换牌；黑市可以装义体或改造程序库。</p></div>
      </div>
      <p class="rule">建议先试一次“四象全谱”：四张不同纪律的程序，容易理解也很稳定。</p>
      <div style="margin-top:16px;text-align:right"><button class="btn primary" id="btn-close-tutorial">开始</button></div>
    </div>
  </div>`;
}

function patchPanelHtml(): string {
  if (!s) return '';
  const cards = s.deck
    .map((p, i) => `<option value="${i}">${String(i + 1).padStart(2, '0')} · ${DISCIPLINE_INFO[p.d].zh} ${p.v}</option>`)
    .join('');
  const disciplines = DISCIPLINES.map((d) => `<option value="${d}">${DISCIPLINE_INFO[d].zh}</option>`).join('');
  return `<div class="patch-panel">
    <div class="patch-head"><span>程序工作台</span><span class="en">PROGRAM PATCH BAY</span><span class="patch-count">牌库 ${s.deck.length}/40</span></div>
    <div class="patch-controls">
      <label>目标程序<select id="patch-card">${cards}</select></label>
      <label>重写为<select id="patch-discipline">${disciplines}</select></label>
      <button class="btn mini" data-patch="boost" ${s.money < PATCH_COSTS.boost ? 'disabled' : ''}>强化 +1 ¤${PATCH_COSTS.boost}</button>
      <button class="btn mini" data-patch="rewrite" ${s.money < PATCH_COSTS.rewrite ? 'disabled' : ''}>重写纪律 ¤${PATCH_COSTS.rewrite}</button>
      <button class="btn mini danger" data-patch="remove" ${s.money < PATCH_COSTS.remove ? 'disabled' : ''}>隔离程序 ¤${PATCH_COSTS.remove}</button>
    </div>
    <div class="patch-hint">改造会持续到本局结束；隔离至少保留 ${12} 张程序，避免牌库失去基本循环。</div>
  </div>`;
}

function implantHtml(def: ImplantDef, mode: 'owned' | 'offer'): string {
  const displayCost = mode === 'offer' && s ? shopPrice(s, def.cost) : def.cost;
  const meta =
    mode === 'owned'
      ? `<button class="btn mini danger" data-sell="${def.id}">卖出 ¤${sellPrice(def)}</button>`
      : `<span class="shop-price">¤${displayCost}</span><button class="btn mini" data-buy="${def.id}">接入</button>`;
  return `<div class="implant" data-implant="${def.id}">
    <div class="implant-name"><span class="badge">${def.zh[0]}</span>${def.zh} <span class="en">${def.en}</span></div>
    <div class="implant-desc">${def.desc}</div>
    <div class="implant-meta"><span class="humcost">人性 −${def.humanity}</span>${meta}</div>
  </div>`;
}

function header(): string {
  if (!s) return '';
  return `<div class="topbar">
    <span class="logo">零日 <span class="en">ZERO-DAY</span></span>
    <span>区段 <b>${s.wing + 1}</b>/4 · ${s.corp.zh}「${s.corp.fortress}」</span>
    <span class="archetype-tag" title="${s.archetype.desc}">${s.archetype.zh}</span>
    <span class="corp-trait" title="${s.corp.traitDesc}">${s.corp.traitZh}</span>
    <span class="money">¤ <b>${s.money}</b></span>
    <span class="humtag">人性 −${s.humanityLoss}</span>
    <span class="seed mono">seed ${s.seed}</span>
    <button class="btn ghost" id="btn-speed">结算 ${fastAnimations ? '快' : '慢'}</button>
    <button class="btn ghost" id="btn-mute">音效 ${sfx.muted ? '关' : '开'}</button>
  </div>`;
}

function implantsRow(): string {
  if (!s) return '';
  if (s.implants.length === 0) return `<div class="implants"><div class="implant-empty">义体槽空空如也——黑市里有二手货</div></div>`;
  return `<div class="implants">${s.implants.map((i) => implantHtml(i, 'owned')).join('')}</div>`;
}

function techTableHtml(): string {
  const rows = [...TECHNIQUES]
    .sort((a, b) => b.rank - a.rank)
    .map(
      (t) => `<div class="tech-row">
      <span class="tech-name">${t.zh} <span class="en">${t.en}</span></span>
      <span class="tech-desc">${t.desc}</span>
      <span class="tech-val mono">${t.base} × ${t.eff}</span>
    </div>`,
    )
    .join('');
  return `<div class="modal-mask" id="modal-mask"><div class="modal">
    <h3>手法表</h3>
    <p class="rule">威力 = 手法基准 + Σ参与程序强度；穿透 = 威力 × 效率。<br>
    攻击时自动从所选程序中枚举子集，取穿透最高的手法结算；同分取更稀有者。</p>
    ${rows}
    <div style="margin-top:16px;text-align:right"><button class="btn" id="btn-close-tech">关闭</button></div>
  </div></div>`;
}

// ---------- 渲染 ----------

function render(): void {
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
  const archetypes = Object.values(ARCHETYPES)
    .map((a) => `<option value="${a.id}">${a.zh} · ${a.desc}</option>`)
    .join('');
  app.innerHTML = `<div class="screen title-screen">
    <div class="title-logo">零 日</div>
    <div class="title-sub en">ZERO-DAY · A CARD ROGUELIKE</div>
    <div class="blurb">
      雾屿城的雨下了三十年。掮客<i>「老蝉」</i>给你转来一单委托：<br>
      潜进企业数据堡，把核心数据拽出来。你的全部本钱，<br>
      是一套手搓程序库和几件二手义体。逐层击穿，见好就收——<br>
      或者死在分期账单里。
    </div>
    <div class="title-loadout">
      <label>潜袭者<select id="archetype-input">${archetypes}</select></label>
      <label>挑战 seed <input id="seed-input" type="number" inputmode="numeric" placeholder="随机"></label>
    </div>
    <div class="title-actions">
      <button class="btn primary" id="btn-start">开始潜入</button>
      <button class="btn" id="btn-title-tech">手法表</button>
    </div>
    <div class="title-stats">本机记录：${stats.runs} 局 · ${stats.wins} 次完成 · 最佳资产 ¤${stats.bestMoney} · 最远区段 ${stats.bestWing}/4</div>
  </div>${techTableOpen ? techTableHtml() : ''}`;
  document.getElementById('btn-start')!.onclick = () => {
    const rawSeed = (document.getElementById('seed-input') as HTMLInputElement).value.trim();
    const parsedSeed = rawSeed === '' ? undefined : Number(rawSeed);
    const archetypeId = (document.getElementById('archetype-input') as HTMLSelectElement).value as ArchetypeId;
    s = newRun(Number.isInteger(parsedSeed) ? parsedSeed : undefined, archetypeId);
    statsRecorded = false;
    tutorialOpen = !tutorialSeen();
    render();
  };
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
        ? `<div class="protocol"><b>固执协议 · ${PROTOCOLS[o.protocol].zh}</b><br>${PROTOCOLS[o.protocol].desc}</div>`
        : '';
      return `<div class="nodecard k-${o.kind}" data-node="${i}" role="button" tabindex="0" aria-label="${info.zh}，需要 ${fmt(visibleThreshold)} 穿透，报酬 ${o.reward}">
        <div class="node-name">${info.zh} <span class="en">${info.en}</span></div>
        <div class="node-th mono">${fmt(visibleThreshold)}</div>
        <div>击穿所需穿透</div>
        <div class="node-reward">报酬 ¤${o.reward}</div>
        ${proto}
      </div>`;
    })
    .join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="h2">选择下手节点 — 打穿任意一个即可深入 · ${s.corp.traitDesc}</div>
    <div class="nodes">${cards}</div>
    ${implantsRow()}
  </div>${tutorialOpen ? tutorialHtml() : ''}`;
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
        <span class="event-choice-title">${choice.title}</span>
        <span class="event-choice-desc">${choice.desc}</span>
      </button>`,
    )
    .join('');
  app.innerHTML = `<div class="screen event-screen">
    ${header()}
    <div class="event-kicker en">INTERCEPTED SIGNAL · ${event.en}</div>
    <div class="event-card">
      <div class="event-title">${event.title}</div>
      <p class="event-text">${event.text}</p>
      <div class="event-choices">${choices}</div>
    </div>
    <div class="event-foot">区段间事件 · 选择会影响资金、人性或程序库 · 当前牌库 ${s.deck.length} 张</div>
  </div>`;
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
      <div class="pchip"><span>威力</span><b class="mono" id="pv">–</b></div>
      <span class="x">×</span>
      <div class="pchip mult"><span>效率</span><b class="mono" id="ev">–</b></div>
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
    setMsg('选 1–5 张程序，此处预演穿透');
    return;
  }
  const chosen = sel.map((i) => s!.hand[i]);
  const r = scorePlay(chosen, s.implants, previewCtx());
  result.classList.add('live');
  if (!r) {
    setMsg('无法构成手法');
    return;
  }
  pv.textContent = fmt(r.power);
  ev.textContent = fmt(r.eff);
  fv.textContent = fmt(r.final);
  const hint = r.cards.length < sel.length ? `<br><span style="opacity:.7">自动选取 ${r.cards.length} 张参与结算</span>` : '';
  setMsg(`<b>${r.techZh}</b>　预计穿透 ${fmt(r.final)}${hint}`);
}

function renderBattle(): void {
  if (!s) return;
  const pct = Math.min(100, (s.roundScore / s.threshold) * 100);
  const proto = s.protocol
    ? `<div class="protocol" style="margin-top:10px"><b>固执协议 · ${PROTOCOLS[s.protocol].zh}</b>　${PROTOCOLS[s.protocol].desc}</div>`
    : '';
  const playRowHtml = playRow
    .map((p) => {
      const info = DISCIPLINE_INFO[p.d];
      return `<div class="slot"><div class="card ${info.cls}" data-pid="${p.id}">
      <div class="wm">${info.glyph}</div>
      <div class="corner">${info.glyph}<span>${info.zh}</span></div>
      <div class="val mono">${p.v}</div>
      <div class="tag en">${info.en.toUpperCase()}</div>
      <div class="vcorner mono">${p.d.slice(0, 2).toUpperCase()}-${String(p.v).padStart(2, '0')}</div>
    </div></div>`;
    })
    .join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="nodebar ${s.protocol ? 'boss' : ''}">
      <div class="nodebar-head">
        <div class="node-name">${NODE_INFO[s.nodeKind!].zh} <span class="en">${NODE_INFO[s.nodeKind!].en}</span></div>
        <div class="score-line"><b class="mono" id="score-num">${fmt(s.roundScore)}</b> / ${fmt(s.threshold)} 穿透</div>
      </div>
      <div class="progress"><div id="score-fill" style="width:${pct}%"></div></div>
      <div class="counters">
        <span>攻击窗口 <b id="plays">${s.playsLeft}/${s.playsMax}</b></span>
        <span>重编译 <b id="discards">${s.discardsLeft}</b></span>
        <span>程序库 <b>${s.hand.length + s.draw.length + s.discard.length}</b></span>
      </div>
      ${proto}
    </div>
    ${implantsRow()}
    ${scoringPanelHtml()}
    <div class="playrow" id="playrow">${playRowHtml}</div>
    <div class="hand" id="hand" aria-label="程序手牌">${s.hand.map((c, i) => cardHtml(c, i, sel.includes(i))).join('')}</div>
    <div class="actions">
      <button class="btn primary" id="btn-play" ${canPlay(s, sel) ? '' : 'disabled'}>攻击<span class="cnt">${s.playsLeft}/${s.playsMax}</span></button>
      <button class="btn" id="btn-discard" ${canDiscard(s, sel) ? '' : 'disabled'}>重编译<span class="cnt">${s.discardsLeft}</span></button>
      <span class="spacer"></span>
      <button class="btn" id="btn-tech">手法表</button>
    </div>
  </div>${techTableOpen ? techTableHtml() : ''}`;

  document.getElementById('hand')!.addEventListener('click', (e) => {
    if (!s || busy) return;
    const el = (e.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el) return;
    const idx = Number(el.dataset.idx);
    if (sel.includes(idx)) {
      sel = sel.filter((i) => i !== idx);
      sfx.unsel();
    } else if (sel.length < 5) {
      sel.push(idx);
      sfx.select();
    }
    render();
  });
  document.getElementById('hand')!.addEventListener('keydown', (e) => {
    const event = e as KeyboardEvent;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const el = (event.target as HTMLElement).closest('.card') as HTMLElement | null;
    if (!el || busy) return;
    event.preventDefault();
    el.click();
  });
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
      ? `<div class="implant-empty">还没有义体</div>`
      : s.implants.map((i) => implantHtml(i, 'owned')).join('');
  const offers =
    s.shopOffers.length === 0
      ? `<div class="sold-out">货架已空（本局义体池有限）</div>`
      : s.shopOffers.map((i) => implantHtml(i, 'offer')).join('');
  app.innerHTML = `<div class="screen">
    ${header()}
    <div class="shop-banner">
      击穿确认。赃款到账：<b>¤${cash?.reward ?? 0}</b>　利息 <b>¤${cash?.interest ?? 0}</b><br>
      <span style="font-size:12px;opacity:.75">每 50 新元结余 +10 利息，上限 40 —— 攒钱也是一种策略</span>
    </div>
    ${patchPanelHtml()}
    <div class="h2">已装载义体 — 人性损耗不可逆，卖出只退钱</div>
    <div class="implants">${owned}</div>
    <div class="h2">黑市货架</div>
    <div class="shop-grid"><div class="shop-row">${offers}</div>
      <div class="shop-row">
        <div class="implant"><div class="implant-name"><span class="badge">掷</span>重掷货架</div>
          <div class="implant-desc">换一批义体。费用每次 +10；掮客折扣同样生效。</div>
          <div class="implant-meta"><span class="shop-price">¤${shopPrice(s, s.rerollCost)}</span>
          <button class="btn mini" id="btn-reroll" ${s.money >= shopPrice(s, s.rerollCost) ? '' : 'disabled'}>重掷</button></div>
        </div>
        <button class="btn primary" id="btn-next" style="margin-top:auto">继续深入 ↓</button>
      </div>
    </div>
  </div>`;
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
  recordRun(s);
  const stats = readStats();
  app.innerHTML = `<div class="screen end-screen">
    <div class="end-title ${won ? 'won' : 'lost'}">${won ? '全身而退' : '连接中断'}</div>
    <div class="end-text">${
      won
        ? '核心数据到手。断线上浮，你把火漆一样的反向追踪甩在数据堡的残骸里。<br>雨还在下，霓虹在水洼里碎掉。老蝉的分成到账——这单，成了。'
        : '反向追踪锁定了你的接入点。权限被吊销，义体被远程锁死，<br>而欠掮客的那笔账，才刚刚开始计息。'
    }</div>
    <div class="end-stats">
      最终资产 <b>¤${s.money}</b> ｜ 人性损耗 <b>−${s.humanityLoss}</b> ｜ 到达区段 <b>${s.wing + 1}/4</b> ｜ seed <b>${s.seed}</b><br>
      ${s.archetype.zh} · 事件选择 ${s.eventHistory.length} 次 · 本机胜率 ${stats.wins}/${stats.runs}
    </div>
    <button class="btn primary" id="btn-restart">再潜一次</button>
  </div>`;
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
  setMsg(`<b>${result.techZh}</b>　结算中…`);

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
      floatText(anchor, `+${ev.power} 威力`, 'pow');
    }
    if (ev.eff) {
      chip(evEl, ev.effTotal);
      floatText(anchor, `+${ev.eff} 效率`, 'eff');
    }
    setMsg(`<b>${ev.label}</b>`);
    await sleep(250);
  }

  // 最终一击
  pv.textContent = fmt(result.power);
  evEl.textContent = fmt(result.eff);
  fv.textContent = fmt(result.final);
  fv.classList.add('slam');
  sfx.slam();
  shake();
  setMsg(`<b>${result.techZh}</b>　穿透 <b style="color:var(--green)">${fmt(result.final)}</b>`);
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
    setMsg(`<b style="color:var(--green)">节点击穿！</b>`);
  } else if (s.phase === 'lost') {
    sfx.hurt();
    setMsg(`<b style="color:var(--red)">反向追踪完成——连接中断</b>`);
  } else {
    setMsg(`剩余攻击窗口 ${s.playsLeft}`);
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
  const t = (e.target as HTMLElement).closest('#btn-mute');
  if (t) {
    sfx.toggle();
    t.textContent = `音效 ${sfx.muted ? '关' : '开'}`;
  }
  const speed = (e.target as HTMLElement).closest('#btn-speed');
  if (speed) {
    fastAnimations = !fastAnimations;
    speed.textContent = `结算 ${fastAnimations ? '快' : '慢'}`;
  }
});

// 调试钩子：沿用黑冰 __BIP.game 惯例，控制台/自动化测试经 window.__zd 操作对局
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

render();
